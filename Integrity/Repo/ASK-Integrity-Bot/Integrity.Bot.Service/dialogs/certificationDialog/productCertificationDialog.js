const path = require('path');
const { ComponentDialog } = require('botbuilder-dialogs');
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
const { Templates } = require('botbuilder-lg');
const moment = require('moment');

const { getData } = require('../../core/accessors/sessionManagement');
const { sendTypingIndicator, productCertificationDetailsTable } = require('../../core/commons/utils');

const DIALOG_ID = 'PRODUCT_CERTIFICATION_DIALOG';
const ALLOW_INTERRUPTS = ['Help', 'StartOver', 'ChangeAgent', 'Commission'];

const {
  getCarriersForAgentAPI,
  getProductTypeForAgentAPI,
  getContractDetailsForAgentAPI,
  getCertificationsAPI
} = require('./certificationDialogAPIs');

class ProductCertificationDialog extends ComponentDialog {
  userState;
  lgFile;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'productCertificationDialog.lg'));

    // Custom function to detect and navigate to interrupts
    Expression.functions.add('ifProductCertificationDialogInterrupts', (args) => {
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

    // Main Product Certification Dialog
    const productCertificationDialog = new AdaptiveDialog(DIALOG_ID).configure({
      generator: new TemplateEngineLanguageGenerator(this.lgFile),
      recognizer: this.createLuisRecognizer(),

      triggers: [
        new OnBeginDialog([
          new CodeAction(this.handleInit.bind(this)),

          // Prompts User for Carrier Name when given wrong Carrier Name provided in initial Utterance
          new TextInput().configure(
            {
              property: new StringExpression('turn.validCarrierName'),
              prompt: new ActivityTemplate('${AskInvalidCarrierDropdownPrompt()}'),
              validations: ['(turn.recognized.entities.carrier[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskInvalidCarrierDropdownPrompt()}'),
              allowInterruptions: new BoolExpression('=ifProductCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
              disabled: new BoolExpression('!dialog.promptForInvalidCarrier')
            }
          ),
          new CodeAction(this.handleInvalidCarrierPrompt.bind(this)),

          // Prompts User for Carrier Name when Carrier Name not provided in initial Utterance
          new TextInput().configure(
            {
              property: new StringExpression('turn.carrierName'),
              prompt: new ActivityTemplate('${AskCarrierNamePrompt()}'),
              validations: ['(turn.recognized.entities.carrier[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskInvalidCarrierDropdownPrompt()}'),
              allowInterruptions: new BoolExpression('=ifProductCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
              disabled: new BoolExpression('!dialog.promptForEmptyCarrier')
            }
          ),
          new CodeAction(this.handleCarrierPrompt.bind(this)),

          // Prompts User for choose Contracts if more 1 contracts is associated with chosen Carrier
          new TextInput().configure(
            {
              property: new StringExpression('turn.contract'),
              prompt: new ActivityTemplate('${AskForContractPrompt()}'),
              // validations: ['(turn.recognized.entities.product[0][0] != null)'], //? Handle this for Issue2
              allowInterruptions: new BoolExpression('=ifProductCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForContract')
            }
          ),
          new CodeAction(this.handleContractPrompt.bind(this)),

          // Prompts User for ProductType when given wrong ProductType provided in initial Utterance
          new TextInput().configure(
            {
              property: new StringExpression('turn.validProductType'),
              prompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
              validations: ['(turn.recognized.entities.product[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
              allowInterruptions: new BoolExpression('=ifProductCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
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
              allowInterruptions: new BoolExpression('=ifProductCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
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
              allowInterruptions: new BoolExpression('=ifProductCertificationDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
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

    this.addDialog(productCertificationDialog);
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
    console.log('certifications handleInit');
    let productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    const restartFlow = dc.state.getValue('turn.restartFlow');
    if (restartFlow) {
      // await this.resetContext(dc);
      await this.updateContext(dc, null, null, null, productCertificationObj.certificationYear, true);
      productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    }

    let agentCarriers = await this.getCarriersForAgent(dc);
    if (!agentCarriers) { // API Error in fetching data
      return dc.endDialog();
    }

    let message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active carriers`;
    if (restartFlow) {
      message = `${dc.state.getValue('conversation.displayAgent.name')} has other active carriers.`;
    }

    if (productCertificationObj.carrierName || productCertificationObj.productType) {
      if (agentCarriers.length === 1) { // Handle Payout details
        await this.handleProductCertificationDetailsFlow(dc, productCertificationObj);
        return dc.endDialog();
      }
      if (agentCarriers.length > 1) { // Handle when more than 1 carrier present for given input(Carrier or Payout)
        if (productCertificationObj.carrierName) {
          message += ` for ${productCertificationObj.carrierName}.`;
        }
      } else { // Handle when 0 carrier present for given input(Carrier or Payout)
        let subMessage = null;
        if (productCertificationObj.carrierName) { // Clear Carrier from Context
          subMessage = ` for ${productCertificationObj.carrierName}`;
          dc.state.setValue('turn.showCarrierName', productCertificationObj.carrierName);
          productCertificationObj.carrierName = null;
        }

        if (productCertificationObj.productType) { // Clear Product Type from Context
          if (subMessage) {
            subMessage += ' and ';
          } else {
            subMessage += ' for ';
          }
          subMessage += ` ${productCertificationObj.productType}`;
          dc.state.setValue('turn.showProductType', productCertificationObj.productType);
          productCertificationObj.productType = null;
        }
        dc.state.setValue('conversation.productCertificationObj', productCertificationObj);

        agentCarriers = await this.getCarriersForAgent(dc);
        if (!agentCarriers) { // API Error in fetching data
          return dc.endDialog();
        }
        if (agentCarriers.length === 0) { // If no Carrier exist for Agent
          message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active certifications`;
          if (subMessage) {
            message += subMessage + '.';
          }
          await this.displayRestartFlowCard(dc, message);
        } else { // If Carrier exists for Agent
          await this.displayCarrierDrowpdown(dc, agentCarriers, 'dialog.promptForInvalidCarrier');
        }
        return dc.endDialog();
      }
    }
    if (agentCarriers.length > 0) { // If Carrier exists for Agent
      await this.displayCarrierDrowpdown(dc, agentCarriers, 'dialog.promptForEmptyCarrier', message);
    } else { // If no Carrier exist for Agent
      await dc.context.sendActivity(`${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active certifications.`);
      dc.state.setValue('turn.restartFlow', false);
      await this.endFlow(dc);
    }
    return dc.endDialog();
  }

  /**
    * Validation for carrier name in reprompt
    * @param {*} dc
    * @param {*} options
    * @returns
    */
  async handleInvalidCarrierPrompt(dc, options) {
    if (!dc.state.getValue('dialog.promptForInvalidCarrier')) {
      return dc.endDialog();
    }

    console.log('contract flow: handleInvalidCarrierPrompt');
    dc.state.setValue('dialog.promptForInvalidCarrier', false);

    await this.updateContext(dc, dc.state.getValue('turn.validCarrierName'));

    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    await this.handleProductCertificationDetailsFlow(dc, productCertificationObj);
    return dc.endDialog();
  }

  /**
   * Validation for carrier name
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleCarrierPrompt(dc, options) {
    if (!dc.state.getValue('dialog.promptForEmptyCarrier')) {
      return dc.endDialog();
    }

    console.log('contract flow: handleCarrierPrompt');
    dc.state.setValue('dialog.promptForEmptyCarrier', false);

    await this.updateContext(dc, dc.state.getValue('turn.carrierName'));
    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    await this.handleProductCertificationDetailsFlow(dc, productCertificationObj);
    return dc.endDialog();
  }


  /**
   * Validation for contract selection
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleContractPrompt(dc, options) {
    if (!dc.state.getValue('dialog.promptForContract')) {
      return dc.endDialog();
    }

    console.log('contract flow: handleContractPrompt');
    dc.state.setValue('dialog.promptForContract', false);

    await this.updateContext(dc, null, dc.context.activity.channelData.data[0].contractId);
    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    await this.handleProductCertificationDetailsFlow(dc, productCertificationObj);
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
    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    await this.handleProductCertificationDetailsFlow(dc, productCertificationObj);
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
    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    await this.handleProductCertificationDetailsFlow(dc, productCertificationObj);
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
    const productCertificationObj = reset ? {} : dc.state.getValue('conversation.productCertificationObj');
    if (carrierName) productCertificationObj.carrierName = carrierName;
    if (contractId) productCertificationObj.contractId = contractId;
    if (productType) productCertificationObj.productType = productType;
    if (certificationYear) productCertificationObj.certificationYear = certificationYear;

    dc.state.setValue('conversation.productCertificationObj', productCertificationObj);
  }


  /**
   * Display the Carrier selection dropdown to the user
   * @param {*} dc
   * @param {*} carrierList
   * @param {*} promptName
   * @param {*} message
   */
  async displayCarrierDrowpdown(dc, carrierList, promptName, message) {
    const displaycarrierList = [];
    carrierList.forEach((item) => {
      displaycarrierList.push({
        title: item.carrierName,
        value: item.carrierName
      });
    });
    dc.state.setValue('turn.showCarrierDdMessage', message);
    dc.state.setValue('conversation.carrierdisplayList', displaycarrierList);
    dc.state.setValue(promptName, true);
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
    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    if (productCertificationObj.carrierName) {
      params.carrierName = productCertificationObj.carrierName;
    }
    if (productCertificationObj.contractId) {
      params.contractId = productCertificationObj.contractId;
    }
    if (productCertificationObj.productType) {
      params.productType = productCertificationObj.productType;
    }
    if (productCertificationObj.certificationYear) {
      params.year = productCertificationObj.certificationYear;
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
   * This methods gets carriers for a agent from API
   * @param {*} dc
   * @returns
   */
  async getCarriersForAgent(dc) {
    const params = await this.exactParamsForAPI(dc);

    await sendTypingIndicator(dc.context);
    const agentCarriers = await getCarriersForAgentAPI(params);
    if (await this.checkForError(dc, agentCarriers)) {
      return null;
    }
    return agentCarriers;
  }


  /**
   * This methods gets product types for a agent from API
   * @param {*} dc
   * @returns
   */
  async getProductTypesForAgents(dc) {
    const params = await this.exactParamsForAPI(dc);

    await sendTypingIndicator(dc.context);
    const agentProductTypes = await getProductTypeForAgentAPI(params);
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
   * This methods gets contracts for a agent from API
   * @param {*} dc
   * @returns
   */
  async getContractsForAgents(dc) {
    const params = await this.exactParamsForAPI(dc);

    await sendTypingIndicator(dc.context);
    const agentPayout = await getContractDetailsForAgentAPI(params);
    if (await this.checkForError(dc, agentPayout)) {
      return null;
    }

    return agentPayout;
  }


  /**
   * This method is used to display Restart flow (Other carriers) card
   * @param {*} dc
   * @param {*} message
   */
  async displayRestartFlowCard(dc, message = null) {
    // dc.state.setValue('conversation.currentYear', new Date().getFullYear());
    const agentName = dc.state.getValue('conversation').displayAgent.name;
    if (message) {
      await dc.context.sendActivity(message);
      message = null;
    }

    message = `Do you want to look at certifications of different carriers for **${agentName}**?`;

    await dc.context.sendActivity(message);
    dc.state.setValue('dialog.promptForRestart', true);
  }


  /**
   * This method is used to display contract prompt (Carousel card or Contract dropdown)
   * @param {*} dc
   * @param {*} agentPayout
   * @returns
   */
  async displayContractsForAgent(dc, agentPayout) {

    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    let message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentPayout.contractDetails.length} contracts for ${productCertificationObj.carrierName}.`;
    if (agentPayout.contractDetails.length > 3) { // Display Contract dropdown if more than 3 Contracts
      await dc.context.sendActivity(message);

      const displaycontractList = [];
      agentPayout.contractDetails.forEach((item) => {
        displaycontractList.push({
          title: this.extractDate(item.startDate) + ' - ' + item.status + ' (' + item.statusReason + ')',
          value: '@#contractId:' + item.contractId + '#@ ' + item.status + ' contract is Selected'
        });
      });
      dc.state.setValue('conversation.contractsDetails', displaycontractList);
      dc.state.setValue('dialog.promptForContract', true);

      return;
    }

    // Display Contract Carousel if 1-3 Contracts
    message += ' **Select one option below:**';
    await dc.context.sendActivity(message);

    const contractCardDataParced = agentPayout.contractDetails.filter((contract) => {
      contract.active = contract.status === 'Active' ? 'Active' : 'null';
      contract.pending = contract.status === 'Pending' ? 'Pending' : 'null';
      contract.terminated = contract.status === 'Terminated' ? 'Terminated' : 'null';
      contract.startDate = this.extractDate(contract.startDate);
      return contract;
    });

    dc.state.setValue('conversation.contractsDetails', contractCardDataParced);
    dc.state.setValue('dialog.promptForContract', true);
  }


  /**
   * Used to extract date
   * @param {*} date
   * @returns
   */
  extractDate(date) {
    return moment(date).format('MM/DD/YYYY');
  }





  async handleProductCertificationDetailsFlow(dc, productCertificationObj) {

    const agentPayout = await this.getContractsForAgents(dc);
    console.log("agent payout", agentPayout);
    const params = await this.exactParamsForAPI(dc);
    const productCertificationDetails = await getCertificationsAPI(params);

    if (agentPayout === null) return; // API Error in fetching data

    // if (agentPayout.contractDetails && agentPayout.contractDetails.length === 0) {
    //   return await this.displayRestartFlowCard(dc, this.lgFile.evaluate('NoContractDetailsText', dc.context.activity));
    // }

    // if (agentPayout.contractDetails && agentPayout.contractDetails.length > 1) {
    //   return await this.displayContractsForAgent(dc, agentPayout);
    // }

    if (productCertificationDetails.data.length && (agentPayout.contractDetails.length && agentPayout.contractDetails[0].productDetails.length > 10)) { // check product > 10 show product dropdown
      const agentProductTypes = await this.getProductTypesForAgents(dc);
      if (agentProductTypes === null) return; // API Error in fetching data

      if (!productCertificationObj.productType && productCertificationDetails.data.length > 10) {
        return await this.displayProductTypeDropdown(dc, agentProductTypes);
      }
    }

    await this.displayProductCertificationDetails(dc);

  }

  async displayProductCertificationDetails(dc) {
    const params = await this.exactParamsForAPI(dc);
    const productCertificationDetails = await getCertificationsAPI(params);
    const productCertificationObj = dc.state.getValue('conversation.productCertificationObj');
    const agentName = dc.state.getValue('conversation').displayAgent.name

    if (productCertificationDetails.data.length) {
      const productCertificationData = await productCertificationDetailsTable(productCertificationDetails.data)
      let message = `Certifications of ${agentName} for ${productCertificationObj.carrierName}`
      if (productCertificationObj.productType) {
        message += `, ${productCertificationObj.productType}`
      }
      message += `:`
      await dc.context.sendActivity(message)
      if (productCertificationData) {
        await dc.context.sendActivity(productCertificationData)
      }
    }
    else if (productCertificationDetails.lastCertified && Object.keys(productCertificationDetails.lastCertified).length) {
      const lastCertifiedYear = productCertificationDetails.lastCertified.year

      let message = `${agentName} doesn't have any carrier certifications for ${productCertificationObj.carrierName}`
      if (productCertificationObj.productType) {
        message += `, ${productCertificationObj.productType}`
      }
      message += ` in ${productCertificationObj.certificationYear}. Last certified for ${productCertificationObj.carrierName}`
      if (productCertificationObj.productType) {
        message += `, ${productCertificationObj.productType}`
      }
      message += ` in ${lastCertifiedYear}.`
      await dc.context.sendActivity(message)
    }
    else {
      let message = `${agentName} doesn't have any carrier certifications for ${productCertificationObj.carrierName} in ${productCertificationObj.certificationYear}`
      await dc.context.sendActivity(message)
    }
    await this.displayRestartFlowCard(dc);
  }

}

module.exports.ProductCertificationDialog = ProductCertificationDialog;