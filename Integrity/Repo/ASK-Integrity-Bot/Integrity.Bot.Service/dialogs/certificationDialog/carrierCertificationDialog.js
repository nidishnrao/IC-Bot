const { ComponentDialog } = require("botbuilder-dialogs");
const { Templates } = require('botbuilder-lg');
const path = require('path');
const {
  AdaptiveDialog,
  LuisAdaptiveRecognizer,
  TemplateEngineLanguageGenerator,
  OnBeginDialog,
  CodeAction,
  TextInput,
  ActivityTemplate,
  IfCondition,
  RepeatDialog,
  SendActivity,
  SwitchCondition,
  Case,
  EndDialog
} = require('botbuilder-dialogs-adaptive');
const { StringExpression, BoolExpression, Expression } = require('adaptive-expressions');
const moment = require('moment');

const { getData } = require('../../core/accessors/sessionManagement');
const { sendTypingIndicator, carrierCertificationDetailsTable } = require('../../core/commons/utils');
const {
  getProductTypeForCertificationAPI,
  getCertificationsAPI
} = require('./certificationDialogAPIs');

const DIALOG_ID = 'CARRIER_CERTIFICATION_DIALOG';
const ALLOW_INTERRUPTS = ['Help', 'StartOver', 'ChangeAgent', 'Commission'];
class CarrierCertificationDialog extends ComponentDialog {
  userState;
  lgFile;
  displayCarrierCertification = false;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    console.log("Directory name", __dirname);
    this.lgFile = Templates.parseFile(path.join(__dirname, 'carrierCertificationDialog.lg'));

    // Custom function to detect and navigate to interrupts
    Expression.functions.add('ifCarrierCertificationDialogInterrupts', (args) => {
      // console.log('\nturn.recognized: ', args[0]);
      for (let i = 0; i < ALLOW_INTERRUPTS.length; i++) {
        if (args[0][ALLOW_INTERRUPTS[i]] && args[0][ALLOW_INTERRUPTS[i]].score >= 0.8) {
          return true;
        }
      }
      if (args[1] && args[1].toLowerCase() === 'hierarchy info') { // FIXME ; Change hierarchy info string
        return true;
      }
      return false;
    });

    // Main Carrier Certification Dialog
    const carrierCertificationDialog = new AdaptiveDialog(DIALOG_ID).configure({
      generator: new TemplateEngineLanguageGenerator(this.lgFile),
      recognizer: this.createLuisRecognizer(),

      triggers: [
        new OnBeginDialog([
          new CodeAction(this.handleInit.bind(this)),

          // Prompts User for ProductType when given wrong ProductType provided in initial Utterance
          new TextInput().configure(
            {
              property: new StringExpression('turn.validProductType'),
              prompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
              validations: ['(turn.recognized.entities.product[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
              allowInterruptions: new BoolExpression('=ifCarrierCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForInvalidProductType')
            }
          ),
          new CodeAction(this.handleInvalidProductTypePrompt.bind(this)),

          // Prompts User for ProductType when ProductType not provided in initial Utterance or When Products > 10 for Chooses Carrier and Contract
          new TextInput().configure(
            {
              property: new StringExpression('turn.productType'),
              prompt: new ActivityTemplate('${AskProductTypePrompt()}'),
              validations: ['(turn.recognized.entities.product[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
              allowInterruptions: new BoolExpression('=ifCarrierCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForEmptyProductType')
            }
          ),
          new CodeAction(this.handleProductTypePrompt.bind(this)),

          // Prompt User if they needs to check Contracts for other Carriers(Restart Flow) or Close the Contract flow
          new TextInput().configure(
            {
              property: new StringExpression('turn.needRestart'),
              prompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
              validations: ['(turn.recognized.entities.yes != null) || (turn.recognized.entities.no != null)'],
              invalidPrompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
              allowInterruptions: new BoolExpression('=ifCarrierCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForRestart')
            }
          ),
          new CodeAction(this.handleNeedRestartPrompt.bind(this)),

          // End the Product Certification flows and start other flows
          new IfCondition().configure({
            condition: new BoolExpression('dialog.endFlow'),
            actions: [
              new SendActivity('${InitiateOtherFlowText()}')
            ]
          }),

          // Restart the Product Certification dialog and prompt User for Carrier Dropdown
          new IfCondition().configure({
            condition: new BoolExpression('turn.restartFlow'),
            actions: [
              new RepeatDialog()
            ]
          })
        ])
      ]
    });

    this.addDialog(carrierCertificationDialog);
    this.initialDialogId = DIALOG_ID;
  }

  /**
   * Create LUIS Recognizer
   * @returns
   */
  createLuisRecognizer() {
    if (process.env.LuisAppId === '' || process.env.LuisAPIHostName === '' || process.env.LuisAPIKey === '') { throw 'Sorry, you need to configure your LUIS application and update .env file.'; }
    return new LuisAdaptiveRecognizer().configure(
      {
        endpoint: new StringExpression(process.env.LuisAPIHostName),
        endpointKey: new StringExpression(process.env.LuisAPIKey),
        applicationId: new StringExpression(process.env.LuisAppId)
      }
    );
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // Handler Methods
  /**
   * Acts as starting point of contract flow and extracts initial information's
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleInit(dc) {
    console.log('carrier certifications handleInit');
    let carrierCertificationObj = dc.state.getValue('conversation.carrierCertificationObj');
    const restartFlow = dc.state.getValue('turn.restartFlow');
    if (restartFlow) {
      await this.updateContext(dc, null, null, null, carrierCertificationObj.certificationYear, true);
      carrierCertificationObj = dc.state.getValue('conversation.carrierCertificationObj');
    }
    const params = await this.exactParamsForAPI(dc);

    if (!carrierCertificationObj.productType) {
      const carrierCertificationDetails = await getCertificationsAPI(params);

      const productTypes = await this.getProductTypesForAgents(dc);
      if (restartFlow || (carrierCertificationDetails.data && carrierCertificationDetails.data.length > 10)) {
        this.displayProductTypeDropdown(dc, productTypes);
        this.displayCarrierCertification = false;
      }
      else {
        this.displayCarrierCertification = true;
      }
    } else {
      this.displayCarrierCertification = true;
    }
    await this.displayCarrierCertificationDetails(dc);
    return dc.endDialog();
  }

  /**
   * Validation for if product type (if provided in the initial utterance is invalid and selected from the dropdown)
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleInvalidProductTypePrompt(dc, options) {
    if (!dc.state.getValue('dialog.promptForInvalidProductType')) {
      return dc.endDialog();
    }

    console.log('contract flow: handleInvalidProductTypePrompt');
    dc.state.setValue('dialog.promptForInvalidProductType', false);

    await this.updateContext(dc, null, null, dc.state.getValue('turn.validProductType'));
    const carrierCertificationObj = dc.state.getValue('conversation.carrierCertificationObj');
    await this.displayCarrierCertificationDetails(dc, carrierCertificationObj);
    return dc.endDialog();
  }


  /**
   * Validation for product type
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleProductTypePrompt(dc, options) {
    if (!dc.state.getValue('dialog.promptForEmptyProductType')) {
      return dc.endDialog();
    }

    console.log('contract flow: handleProductTypePrompt');
    dc.state.setValue('dialog.promptForEmptyProductType', false);

    await this.updateContext(dc, null, null, dc.state.getValue('turn.productType'));
    const carrierCertificationObj = dc.state.getValue('conversation.carrierCertificationObj');
    this.displayCarrierCertification = true;
    await this.displayCarrierCertificationDetails(dc, carrierCertificationObj);
    return dc.endDialog();
  }


  /**
   * Vindication of restart flow prompt (Other carriers prompt)
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleNeedRestartPrompt(dc, options) {
    if (!dc.state.getValue('dialog.promptForRestart')) {
      return dc.endDialog();
    }

    console.log('contract flow: handleNeedRestartPrompt');
    dc.state.setValue('dialog.promptForRestart', false);

    const status = dc.state.getValue('turn.needRestart').toLowerCase();
    if (status === 'no, thanks') { // No is clicked
      await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
      dc.state.setValue('dialog.endFlow', true);
      return dc.endDialog();
    }
    dc.state.setValue('turn.restartFlow', true); // Yes is clicked
    return dc.endDialog();
  }


  /**
 * Handle end flow
 * @param {*} dc
 */
  async endFlow(dc) {
    dc.state.setValue('dialog.endFlow', true);
  }


  /**
   * Update contractObj with carrier name, contractId, productType and subFlow
   * @param {*} dc
   * @param {*} carrierName
   * @param {*} contractId
   * @param {*} productType
   * @param {*} reset
   */
  async updateContext(dc, carrierName = null, contractId = null, productType = null, certificationYear = null, reset = null) {
    const carrierCertificationObj = reset ? {} : dc.state.getValue('conversation.carrierCertificationObj');
    if (carrierName) carrierCertificationObj.carrierName = carrierName;
    if (contractId) carrierCertificationObj.contractId = contractId;
    if (productType) carrierCertificationObj.productType = productType;
    if (certificationYear) carrierCertificationObj.certificationYear = certificationYear;

    dc.state.setValue('conversation.carrierCertificationObj', carrierCertificationObj);
  }

  /**
   * Used to extract data from DC for generating API params
   * @param {*} dc
   * @returns
   */
  async exactParamsForAPI(dc) {
    const params = {
      authCode: dc.context.activity.channelData.authToken,
      apiBaseUrl: await getData(this.userState, dc.context, 'hostUrl'),
      agentId: dc.state.getValue('conversation.displayAgent').agentId
    };
    const carrierCertificationObj = dc.state.getValue('conversation.carrierCertificationObj');
    if (carrierCertificationObj.productType) {
      params.productType = carrierCertificationObj.productType;
    }
    if (carrierCertificationObj.certificationYear) {
      params.year = carrierCertificationObj.certificationYear;
    }
    return params;
  }


  // Service Methods
  /**
   * Check for API errors
   * @param {*} dc
   * @param {*} response
   * @returns
   */
  async checkForError(dc, response) {
    if (typeof response === 'string' && ((response.toLowerCase().includes('doctype html')) || response.includes('Unauthorized') || response.includes('Error'))) {
      await dc.context.sendActivity(this.lgFile.evaluate('APIErrorText', dc.context.activity));
      return true;
    }
    return false;
  }


  /**
   * This methods gets product types for a agent from API
   * @param {*} dc
   * @returns
   */
  async getProductTypesForAgents(dc) {
    const params = await this.exactParamsForAPI(dc);

    await sendTypingIndicator(dc.context);
    const agentProductTypes = await getProductTypeForCertificationAPI(params);
    if (await this.checkForError(dc, agentProductTypes)) {
      return null;
    }

    return agentProductTypes;
  }

  /**
   * Display the product type dropdown to the user
   * @param {*} dc
   * @param {*} productList
   * @param {*} prmoptName
   * @returns
   */
  async displayProductTypeDropdown(dc, productList, prmoptName = 'dialog.promptForEmptyProductType') {
    const displayproductList = [];
    productList.forEach((item) => {
      displayproductList.push({
        title: item.productTypeName,
        value: item.productTypeName
      });
    });
    dc.state.setValue('conversation.productdisplayList', displayproductList);
    dc.state.setValue(prmoptName, true);
    return true;
  }


  /**
   * This method is used to display Restart flow (Other carriers) card
   * @param {*} dc
   * @param {*} message
   */
  async displayRestartFlowCard(dc, message = null) {
    dc.state.setValue('conversation.currentYear', new Date().getFullYear());
    const agentName = dc.state.getValue('conversation').displayAgent.name;
    if (message) {
      await dc.context.sendActivity(message);
      message = null;
    }

    message = `Do you want to look at certifications of different product type for **${agentName}**?`;

    await dc.context.sendActivity(message);
    dc.state.setValue('dialog.promptForRestart', true);
  }


  /**
   * Used to extract date
   * @param {*} date
   * @returns
   */
  extractDate(date) {
    return moment(date).format('MM/DD/YYYY');
  }

  async displayCarrierCertificationDetails(dc) {
    if (this.displayCarrierCertification) {
      const params = await this.exactParamsForAPI(dc);
      const carrierCertificationDetails = await getCertificationsAPI(params);
      const carrierCertificationObj = dc.state.getValue('conversation.carrierCertificationObj');
      const agentName = dc.state.getValue('conversation').displayAgent.name

      if (carrierCertificationDetails.data.length) {
        const carrierCertificationData = await carrierCertificationDetailsTable(carrierCertificationDetails.data)
        let message = `${agentName} certifications`;
        if (carrierCertificationObj.productType) {
          message += ` for ${carrierCertificationObj.productType}`;
        }
        message += ` in ${carrierCertificationObj.certificationYear}`;
        await dc.context.sendActivity(message)
        if (carrierCertificationData) {
          await dc.context.sendActivity(carrierCertificationData);
        }
      }
      else {
        let message = `${agentName} doesn't have any carrier certifications`
        if (carrierCertificationObj.productType) {
          message += ` for ${carrierCertificationObj.productType} `
        }
        message += ` in ${carrierCertificationObj.certificationYear}`
        await dc.context.sendActivity(message)
      }
      if (carrierCertificationDetails.data.length <= 10 && !carrierCertificationObj.productType) {
        dc.state.setValue('dialog.endFlow', true);
        return dc.endDialog();
      }
      else {
        await this.displayRestartFlowCard(dc);
      }


    }

  }

}

module.exports.CarrierCertificationDialog = CarrierCertificationDialog;