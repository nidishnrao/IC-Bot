/* eslint-disable no-undef */
/* eslint-disable no-throw-literal */
/* eslint-disable no-template-curly-in-string */
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
  SendActivity
} = require('botbuilder-dialogs-adaptive');

const {
  getAgentProduction,
  getCarrierForAgent,
  getProductType,
  getProductionDetailsForProductType } = require('./productionDialogAPIs');
const { StringExpression, BoolExpression, Expression } = require('adaptive-expressions');
const { Templates } = require('botbuilder-lg');

const { getData } = require('../../core/accessors/sessionManagement');
const { getProductionCards, productionDetailsTable, getAxiosReq, sendTypingIndicator } = require('../../core/commons/utils');
const { API_VERSION, UP_ICON, DOWN_ICON, NO_CHANGE_ICON } = require('../../core/commons/config');

const DIALOG_ID = 'PRODUCTION_DIALOG';

/**
 * Used to get production for the agent
 */
class ProductionDialog extends ComponentDialog {
  userState;
  lgFile;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'productionDialog.lg'));

    // Custom function to detect interrupts
    Expression.functions.add('checkForProductionDialogInterrupt', (args) => {
      console.log('\nturn.recognized: ', args[0]);
      const allowInterrupts = ['Help', 'StartOver', 'ChangeAgent', 'Contract'];
      for (let i = 0; i < allowInterrupts.length; i++) {
        if (args[0][allowInterrupts[i]] && args[0][allowInterrupts[i]].score >= 0.8) {
          return true;
        }
      }
      return false;
    });

    // Production Dialog
    const productionDialog = new AdaptiveDialog(DIALOG_ID).configure({
      generator: new TemplateEngineLanguageGenerator(this.lgFile),
      recognizer: this.createLuisRecognizer(),

      triggers: [
        new OnBeginDialog([
          new CodeAction(this.handleInitialProductionFlow.bind(this)),

          // Ask for carrier name prompt
          new IfCondition().configure({
            condition: new BoolExpression('dialog.promptForEmptyCarrier'),
            actions: [
              new SendActivity('${AskCarrierNamePrompt()}')
            ]
          }),
          new TextInput().configure(
            {
              property: new StringExpression('turn.carrierName'),
              prompt: new ActivityTemplate('${AskCarrierNameNoThanksPrompt()}'),
              validations: ['(turn.recognized.entities.carrier[0][0] != null) || (turn.recognized.entities.noThanks != null)'],
              invalidPrompt: new ActivityTemplate('${CarrierRepromptDropdownText()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'), // new BoolExpression("false"),
              disabled: new BoolExpression('!dialog.promptForEmptyCarrier')
            }
          ),
          new CodeAction(this.validateCarrierName.bind(this)),

          // Ask for carrier name second time prompt
          new TextInput().configure(
            {
              property: new StringExpression('turn.carrierName'),
              prompt: new ActivityTemplate('${CarrierRepromptDropdownText()}'),
              validations: ['(turn.recognized.entities.carrier[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${CarrierRepromptDropdownText()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'), // new BoolExpression("false"),
              disabled: new BoolExpression('!dialog.repromptForEmptyCarrier')
            }
          ),
          new CodeAction(this.validateCarrierNameForReprompt.bind(this)),

          // Ask for other carrier name confirm prompt
          new TextInput().configure(
            {
              property: new StringExpression('turn.otherCarrierConfirm'),
              prompt: new ActivityTemplate('${AskOtherCarrierConfirmPrompt()}'),
              validations: ['(turn.recognized.entities.yesOtherCarriers != null) || (turn.recognized.entities.noThanks != null)'],
              invalidPrompt: new ActivityTemplate('${AskOtherCarrierConfirmPrompt()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'),
              disabled: new BoolExpression('!dialog.checkForSimilarCarriers')
            }
          ),
          new CodeAction(this.checkForSimilarCarriers.bind(this)),

          // Ask for other carrier name prompt
          new TextInput().configure(
            {
              property: new StringExpression('turn.similarCarrierName'),
              prompt: new ActivityTemplate('${AskSimilarCarrierNamePrompt()}'),
              validations: ['(turn.recognized.entities.carrier[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskSimilarCarrierNamePrompt()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'),
              disabled: new BoolExpression('!dialog.similarCarrierPrompt')
            }
          ),
          new CodeAction(this.validateSimilarCarrier.bind(this)),

          // Prompt User if they needs check Contracts for other Carriers(Restart Flow) or Close the Contract flow
          new TextInput().configure(
            {
              property: new StringExpression('turn.needRestart'),
              prompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
              validations: ['(turn.recognized.entities.yes != null) || (turn.recognized.entities.no != null)'],
              invalidPrompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
              allowInterruptions: new BoolExpression('=ifContractDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForRestart')
            }
          ),
          new CodeAction(this.handleNeedRestartPrompt.bind(this)),

          // Ask for product type again if given at start is wrong
          new TextInput().configure(
            {
              property: new StringExpression('turn.productType'),
              prompt: new ActivityTemplate('${ProductRepromptDropdownText()}'),
              validations: ['(turn.recognized.entities.product[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${ProductRepromptDropdownText()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'),
              disabled: new BoolExpression('!dialog.checkForProductType')
            }
          ),
          new CodeAction(this.checkIfValidProductType.bind(this)),

          // Ask for product type confirm prompt
          new TextInput().configure(
            {
              property: new StringExpression('turn.showProductType'),
              prompt: new ActivityTemplate('${AskProductTypeConfirmPrompt()}'),
              validations: ['(turn.recognized.entities.productionByProduct != null) || (turn.recognized.entities.noThanks != null)'],
              invalidPrompt: new ActivityTemplate('${AskProductTypeConfirmPrompt()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'),
              disabled: new BoolExpression('!dialog.proptForProductType')
            }
          ),
          new CodeAction(this.checkToProceedForProductType.bind(this)),
          
          new TextInput().configure(
            {
                property: new StringExpression('turn.needRestart'),
                prompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
                validations: ['(turn.recognized.entities.yes != null) || (turn.recognized.entities.no != null)'],
                invalidPrompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
                allowInterruptions: new BoolExpression('=ifHierarchyDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
                disabled: new BoolExpression('!dialog.promptForRestart')
            }
        ),
        new CodeAction(this.handleNeedRestartPrompt.bind(this)),

          // Ask for product type prompt
          new TextInput().configure(
            {
              property: new StringExpression('turn.productType'),
              prompt: new ActivityTemplate('${AskForProductTypePrompt()}'),
              validations: ['(turn.recognized.entities.product[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskForProductTypePrompt()}'),
              allowInterruptions: new BoolExpression('=checkForProductionDialogInterrupt(turn.recognized.intents)'),
              disabled: new BoolExpression('!dialog.productTypeRequired')
            }
          ),
          new CodeAction(this.validateproductType.bind(this)),

          // End the production flow and start other flows          
          new IfCondition().configure({
            condition: new BoolExpression('dialog.endFlow'),
            actions: [
              new SendActivity('${InitiateOtherFlowText()}')
            ]
          }),
        ])
      ]
    });

    this.addDialog(productionDialog);
    this.initialDialogId = DIALOG_ID;
  }

  /**
   * Used to create LUIS Recognizer
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

  /**
   * Handle initial flow, extract entities given at the start
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleInitialProductionFlow(dc, options) {
    console.log('handleInitialProductionFlow');
    const productionObj = dc.state.getValue('conversation.productionObj');
    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId
    };

    if (!!productionObj.carrierName) {
      params.carrierName = productionObj.carrierName;
    }
    if (!!productionObj.productType) {
      params.productType = productionObj.productType;
    }

    const agentCarriers = await this.getAgentSpecificCarries(dc, apiBaseUrl, authCode, params, true);
    if (!agentCarriers) { // Error getting Carriers for agent
      return dc.endDialog();
    }
    if (params.carrierName) {
      if (agentCarriers.length === 1) {
        // Display production deatails for product type
        await this.handleProductType(dc, productionObj);
      }
      if (agentCarriers.length > 1) {
        // Display carrier dropdown to choose for displaying
        dc.state.setValue('turn.similarCarrierTitle', params.carrierName);
        await this.displayCarrierDrowpdown(dc, agentCarriers, 'dialog.similarCarrierPrompt');
      }
      return dc.endDialog();
    }
    await this.getAgentProductionSummaryDetails(dc, apiBaseUrl, authCode, params, agentCarriers);
    return dc.endDialog();
  }

  /**
   * Validation for carrier name
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async validateCarrierName(dc, options) {
    if (!dc.state.getValue('dialog.promptForEmptyCarrier')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.promptForEmptyCarrier', false);
    console.log('turn.carrierName: ', dc.state.getValue('turn.carrierName'));

    if (dc.state.getValue('turn.recognized.entities.noThanks') != null) {
      // await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
      await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
      dc.state.setValue('dialog.endFlow', true);

      return dc.endDialog();
    }

    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId
    };

    // Store carrier name in production object
    const productionObj = dc.state.getValue('conversation.productionObj');
    productionObj.carrierName = dc.state.getValue('turn.carrierName');
    if (productionObj.carrierName) {
      params.carrierName = productionObj.carrierName;
    }
    dc.state.setValue('conversation.productionObj', productionObj);
    if (await this.getAgentProductionSummary(dc, apiBaseUrl, authCode, params)) {
      return dc.endDialog();
    }

    // Product type is given at the begening
    await this.handleProductType(dc, productionObj);
    return dc.endDialog();
  }

  /**
   * Validation for carrier name on reprompt
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async validateCarrierNameForReprompt(dc, options) {
    if (!dc.state.getValue('dialog.repromptForEmptyCarrier')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.repromptForEmptyCarrier', false);
    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId,
      carrierName: dc.state.getValue('turn.carrierName')
    };

    const agentCarriers = await this.getAgentSpecificCarries(dc, apiBaseUrl, authCode, params, false);
    if (!agentCarriers) {
      return dc.endDialog();
    }
    // dc.state.setValue('dialog.promptForEmptyCarrier', true);
    // await this.validateCarrierName(dc, options);

    // Store carrier name in production object
    const productionObj = dc.state.getValue('conversation.productionObj');
    productionObj.carrierName = dc.state.getValue('turn.carrierName');
    if (productionObj.carrierName) {
      params.carrierName = productionObj.carrierName;
    }

    if (productionObj.productType) {
      params.productType = productionObj.productType;
    }
    dc.state.setValue('conversation.productionObj', productionObj);

    if (await this.getAgentProductionSummaryDetails(dc, apiBaseUrl, authCode, params, agentCarriers)) {
      return dc.endDialog();
    }

    // Product type is given at the begening
    await this.handleProductType(dc, productionObj);

    return dc.endDialog();
  }

  /**
   * Check for similar carriers if carrier name is given at the start
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async checkForSimilarCarriers(dc, options) {
    if (!dc.state.getValue('dialog.checkForSimilarCarriers')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.checkForSimilarCarriers', false);
    console.log('turn.otherCarrierConfirm: ', dc.state.getValue('turn.otherCarrierConfirm'));
    const productionObj = dc.state.getValue('conversation.productionObj');
    if (dc.state.getValue('turn.recognized.entities.noThanks') != null) {
      // Product type is given at the begening
      await this.handleProductType(dc, productionObj);
      return dc.endDialog();
    }

    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId,
      carrierName: productionObj.carrierName
    };
    const agentCarriers = await this.getAgentSpecificCarries(dc, apiBaseUrl, authCode, params, false);
    if (!agentCarriers) {
      return dc.endDialog();
    }
    dc.state.setValue('turn.similarCarrierTitle', productionObj.carrierName);
    await this.displayCarrierDrowpdown(dc, agentCarriers, 'dialog.similarCarrierPrompt');
    return dc.endDialog();
  }

  /**
   * Validation for similar carriers
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async validateSimilarCarrier(dc, options) {
    if (!dc.state.getValue('dialog.similarCarrierPrompt')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.similarCarrierPrompt', false);
    console.log('turn.similarCarrierName: ', dc.state.getValue('turn.similarCarrierName'));

    // Store carrier name in production object
    const productionObj = dc.state.getValue('conversation.productionObj');
    productionObj.carrierName = dc.state.getValue('turn.similarCarrierName');
    if (!productionObj.productType) {
      const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
      const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
      const params = {
        agentId: dc.state.getValue('conversation.displayAgent').agentId,
        carrierName: productionObj.carrierName
      };
      dc.state.setValue('conversation.productionObj', productionObj);
      if (await this.getAgentProductionSummary(dc, apiBaseUrl, authCode, params)) {
        return dc.endDialog();
      }
    }

    // Product type is given at the begening
    await this.handleProductType(dc, productionObj);
    return dc.endDialog();
  }

  /**
   * Validation for if the product type is valid
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async checkIfValidProductType(dc, options) {
    if (!dc.state.getValue('dialog.checkForProductType')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.checkForProductType', false);
    // Store product type in production object
    const productionObj = dc.state.getValue('conversation.productionObj');
    productionObj.productType = dc.state.getValue('turn.productType');
    dc.state.setValue('conversation.productionObj', productionObj);

    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId,
      carrierName: productionObj.carrierName,
      productType: productionObj.productType
    };
    await this.getAgentProductionSummaryForProductType(dc, apiBaseUrl, authCode, params, false);
    return dc.endDialog();
  }

  /**
   * Check if user selects product type button
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async checkToProceedForProductType(dc, options) {
    console.log('turn.showProductType: ', dc.state.getValue('turn.showProductType'));
    if (!dc.state.getValue('dialog.proptForProductType') || dc.state.getValue('turn.showProductType') == null) { // dc.state.getValue('dialog.proptForProductType') == null){
      return dc.endDialog();
    }

    dc.state.setValue('dialog.proptForProductType', false);

    const showProductType = dc.state.getValue('turn.showProductType').toLowerCase();

    if (showProductType === 'no, thanks') {
      await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
      dc.state.setValue('dialog.endFlow', true);
      return dc.endDialog();
    }

    const productionObj = dc.state.getValue('conversation.productionObj');

    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId,
      carrierName: productionObj.carrierName
    };
    await this.getAgentProductionSummaryForProductType(dc, apiBaseUrl, authCode, params, true);// true
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
   * Validation for product type
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async validateproductType(dc, options) {
    if (!dc.state.getValue('dialog.productTypeRequired')) {
      return dc.endDialog();
    }
    dc.state.setValue('dialog.productTypeRequired', false);
    console.log('turn.productType: ', dc.state.getValue('turn.productType'));

    // Store product type in production object
    const productionObj = dc.state.getValue('conversation.productionObj');
    productionObj.productType = dc.state.getValue('turn.productType');
    dc.state.setValue('conversation.productionObj', productionObj);

    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId,
      carrierName: productionObj.carrierName,
      productType: productionObj.productType
    };
    await this.getAgentProductionSummaryForProductType(dc, apiBaseUrl, authCode, params, false, true);
    return dc.endDialog();
  }

  /**
   * This method is used to display Restart flow (Other carriers) card
   * @param {*} dc
   * @param {*} message
   */
   async displayRestartFlowCard(dc, message = null) {
    if (message) {
      await dc.context.sendActivity(message);
      message = null;
    }

    const contractObj = dc.state.getValue('conversation.contractObj');
    message = 'Do you want to look at productions of other carriers  ';
    
    message += `for **${dc.state.getValue('conversation.displayAgent.name')}**?`;
    await dc.context.sendActivity(message);
    dc.state.setValue('dialog.promptForRestart', true);
  }

  /**
   * Service Methods used for Production YTD Dialog Flows
   */

  /**
   * Get production summary details
   * @param {*} dc
   * @param {*} apiBaseUrl
   * @param {*} authCode
   * @param {*} params
   * @param {*} allowPrompt
   * @param {*} lastPrompt
   * @returns
   */
  async getAgentProductionSummaryForProductType(dc, apiBaseUrl, authCode, params, allowPrompt, lastPrompt) {
    const productionDetailForProduct = await this.getProductionDetailsForCarrier(dc, apiBaseUrl, authCode, params);

    if (!productionDetailForProduct) {
      await dc.context.sendActivity('Internal server error');
      return;
    }

    if (productionDetailForProduct.length === 0) {
      // Ask product type again
      if (allowPrompt) {
        // Ask for product type again

        const productList = await getProductType(apiBaseUrl, authCode, params.agentId, params.carrierName);
        if (await this.checkForError(dc, productList)) {
          return;
        }

        await dc.context.sendActivity('No production details available for product types');        
        dc.state.setValue('dialog.endFlow', true);
        return;

        // dc.state.setValue('dialog.checkForProductType', true);
      } else {
        await dc.context.sendActivity(this.lgFile.evaluate('ProductNotFoundText', dc.context.activity));
        await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
        dc.state.setValue('dialog.endFlow', true);
        // await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
      }
      return;
    }
    if (!allowPrompt && productionDetailForProduct.length > 10
      && !await this.handleProductTypeDropdown(dc, authCode, params)) {
      return;
    }

    if (productionDetailForProduct.length > 10) {
      if (!lastPrompt) {
        await this.handleProductTypeDropdown(dc, apiBaseUrl, authCode, params);
      } else {
        await dc.context.sendActivity(this.lgFile.evaluate('MoreProductTypeForCarrierText', dc.context.activity));
        await this.displayProductionDetailsProductType(dc, productionDetailForProduct.slice(0, 10), params.productType, params.carrierName);
        // await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
        await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
        dc.state.setValue('dialog.endFlow', true);
      }
      return;
    }
    await this.displayProductionDetailsProductType(dc, productionDetailForProduct, params.productType, params.carrierName);
    // await this.displayRestartFlowCard(dc);
  }

  /**
   * Get the production details
   * @param {*} dc
   * @param {*} apiBaseUrl
   * @param {*} authCode
   * @param {*} params
   * @returns
   */
  async getProductionDetailsForCarrier(dc, apiBaseUrl, authCode, params) {
    await sendTypingIndicator(dc.context);
    const productionDetailForProduct = await getProductionDetailsForProductType(apiBaseUrl, authCode, params);
    if (await this.checkForError(dc, productionDetailForProduct)) {
      return false;
    }

    return productionDetailForProduct;
  }

  /**
   * Display the product type dropdown to users
   * @param {*} dc
   * @param {*} productList
   * @returns
   */
  async displayProductTypeDropdown(dc, productList, promptName = 'dialog.productTypeRequired') {
    const displayproductList = [];
    productList.forEach((item) => {
      console.log('Value', item.productTypeName);
      displayproductList.push({
        title: item.productTypeName,
        value: item.productTypeName
      });
    });
    dc.state.setValue('conversation.productdisplayList', displayproductList);
    dc.state.setValue(promptName, true);

    return true;
  }

  /**
   * Handle Product type select
   * @param {*} dc
   * @param {*} apiBaseUrl
   * @param {*} authCode
   * @param {*} params
   * @returns
   */
  async handleProductTypeDropdown(dc, apiBaseUrl, authCode, params) {
    await sendTypingIndicator(dc.context);
    const productList = await getProductType(apiBaseUrl, authCode, params.agentId, params.carrierName);
    if (await this.checkForError(dc, productList)) {
      return false;
    }
    await this.displayProductTypeDropdown(dc, productList);
    return true;
  }

  /**
   * Handle user given product type
   * @param {*} dc
   * @param {*} productionObj
   * @returns
   */
  async handleProductType(dc, productionObj) {
    const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
    const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
    const params = {
      agentId: dc.state.getValue('conversation.displayAgent').agentId,
      carrierName: productionObj.carrierName
    };

    if (!productionObj.productType) {
      // const productionDetailForProduct = await this.getProductionDetailsForCarrier(dc, apiBaseUrl, authCode, params);
      // if (!productionDetailForProduct || (productionDetailForProduct && productionDetailForProduct.length === 0)) {
      //     await dc.context.sendActivity(this.lgFile.evaluate('ProductTypeForCarrierNotAvilableText', dc.context.activity));
      //     await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
      //     return false;
      // }

      dc.state.setValue('dialog.proptForProductType', true);
      return false;
    }

    // Add product name in params
    params.productType = productionObj.productType;
    return await this.getAgentProductionSummaryForProductType(dc, apiBaseUrl, authCode, params, true);
  }

  /**
   * Get carrier list
   * @param {*} dc
   * @param {*} apiBaseUrl
   * @param {*} authCode
   * @param {*} params
   * @param {*} allowPrompt
   * @returns
   */
  async getAgentSpecificCarries(dc, apiBaseUrl, authCode, params, allowPrompt) {
    await sendTypingIndicator(dc.context);
    const agentCarriers = await getCarrierForAgent(apiBaseUrl, authCode, params.agentId, params);
    if (await this.checkForError(dc, agentCarriers)) {
      return null;
    }

    if (params.carrierName && agentCarriers.length === 0) {
      if (allowPrompt) {
        dc.state.setValue('turn.carrierNameTitle', params.carrierName);
        const carrierNameForDisplay = params.carrierName;
        params.carrierName = null;
        const agentCarriersforDropdown = await getCarrierForAgent(apiBaseUrl, authCode, params.agentId, params);
        if (!agentCarriersforDropdown) { // No Carriers for agent
          return null;
        }
        if (agentCarriersforDropdown.length > 0) {
          await this.displayCarrierDrowpdown(dc, agentCarriersforDropdown, 'dialog.repromptForEmptyCarrier');
        } else {
          message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active contracts for ${carrierNameForDisplay}`;
          await dc.context.sendActivity(message);
        }

        // dc.state.setValue('dialog.repromptForEmptyCarrier', true);
      } else {
        await dc.context.sendActivity(this.lgFile.evaluate('CarrierNotFoundText', dc.context.activity));
        await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
        dc.state.setValue('dialog.endFlow', true);
        // await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
      }
      return null;
    }
    return agentCarriers;
  }

  /**
   * Get production summary
   * @param {*} dc
   * @param {*} apiBaseUrl
   * @param {*} authCode
   * @param {*} params
   * @returns
   */
  async getAgentProductionSummary(dc, apiBaseUrl, authCode, params) {
    await sendTypingIndicator(dc.context);
    const productionSummary = await getAgentProduction(apiBaseUrl, authCode, params.agentId, params);
    if (await this.checkForError(dc, productionSummary)) {
      return true;
    }
    await this.displayProductionSummary(dc, this.parseProductionSummary(productionSummary), params);
    return false;
  }

  /**
   * Get production details
   * @param {*} dc
   * @param {*} apiBaseUrl
   * @param {*} authCode
   * @param {*} params
   * @param {*} agentCarriers
   * @returns
   */
  async getAgentProductionSummaryDetails(dc, apiBaseUrl, authCode, params, agentCarriers) {
    if (await this.getAgentProductionSummary(dc, apiBaseUrl, authCode, params)) {
      return true;
    }
    if (params.carrierName) {
      if (agentCarriers.length === 1) {
        if (!params.productType) {
          // const productionDetailForProduct = await this.getProductionDetailsForCarrier(dc, apiBaseUrl, authCode, params);
          // if (!productionDetailForProduct || (productionDetailForProduct && productionDetailForProduct.length === 0)) {
          //     await dc.context.sendActivity(this.lgFile.evaluate('ProductTypeForCarrierNotAvilableText', dc.context.activity));
          //     // return false;
          //     await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
          //     return true;
          // }
          dc.state.setValue('dialog.proptForProductType', true);
        }
      }
      if (agentCarriers.length > 1) {
        console.log('Carrier name provided at the start and more than 1 found');
        dc.state.setValue('turn.similarCarrierTitle', params.carrierName);
        dc.state.setValue('dialog.checkForSimilarCarriers', true);
      }
      return false;
    }
    if (agentCarriers.length > 0) {
      await this.displayCarrierDrowpdown(dc, agentCarriers, 'dialog.promptForEmptyCarrier');
    }
    return false;
  }

  /**
   * Display production summary card
   * @param {*} dc
   * @param {*} productionInfo
   * @param {*} params
   */
  async displayProductionSummary(dc, productionInfo, params) {
    console.log('displayProductionSummary');
    let message = 'The total production generated by ';

    message += `${dc.state.getValue('conversation.displayAgent').name} `;
    if (params.productType) {
      message += ` for ${params.productType} `;
    }
    if (params.carrierName) {
      message += ` for ${params.carrierName} `;
    }
    message += 'in 2021 is:';
    await dc.context.sendActivity(message);
    await dc.context.sendActivity(await getProductionCards(productionInfo));
  }

  /**
   * Display carrier dropdown to users
   * @param {*} dc
   * @param {*} carrierList
   * @param {*} promptName
   */
  async displayCarrierDrowpdown(dc, carrierList, promptName) {
    console.log('carrierList: ', carrierList);
    const displaycarrierList = [];
    carrierList.forEach((item) => {
      console.log('Value', item.carrierName);
      displaycarrierList.push({
        // "title": item.carrierName,
        title: item.carrierName,
        value: item.carrierName
      });
    });
    dc.state.setValue('conversation.carrierdisplayList', displaycarrierList);
    dc.state.setValue(promptName, true);
    
  }

  /**
   * Display production details card
   * @param {*} dc
   * @param {*} productionDetailsInfo
   * @param {*} productType
   */
  async displayProductionDetailsProductType(dc, productionDetailsInfo, productType, carrierName) {
    console.log('productionDetailsInfo: ', productionDetailsInfo);
    const productionDetailsCard = await productionDetailsTable(productionDetailsInfo);
    let msg = 'Here is the YTD production details for ' + carrierName;
    if (productType) {
      msg = msg + `, ${productType}`;
    }
    msg = msg + ':';
    await dc.context.sendActivity(msg);
    await dc.context.sendActivity(productionDetailsCard);
    // await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
    await this.displayRestartFlowCard(dc);
  }

  /**
   * Parse production summary as required by the card
   * @param {*} productionSummary
   * @returns
   */
  parseProductionSummary(productionSummary) {
    const YTD = {
      group: 'YTD',
      production: productionSummary.ytdAmount,
      indicatorURL: (productionSummary.ytdIndicator === 'Postive') ? UP_ICON : (productionSummary.ytdIndicator === 'Negative' ? DOWN_ICON : NO_CHANGE_ICON),
      differenceAmount: Math.abs(productionSummary.ytdAmount - productionSummary.prevYtdAmount),
      percent: productionSummary.ytdPercentage,
      message: 'Compared to last year'
    };

    // const LTM = {
    //     group: 'LTM',
    //     production: productionSummary.ltmAmount,
    //     indicatorURL: (productionSummary.ltmIndicator === 'Postive') ? UP_ICON : (productionSummary.ltmIndicator === 'Negative' ? DOWN_ICON : NO_CHANGE_ICON),
    //     differenceAmount: Math.abs(productionSummary.ltmAmount - productionSummary.prevLtmAmount),
    //     percent: productionSummary.ltmPercentage,
    //     message: 'Compared to prior LTM'
    // };

    // return [YTD, LTM];
    return [YTD];
  }

  /**
   * Check for API errors
   * @param {*} dc
   * @param {*} response
   * @returns
   */
  async checkForError(dc, response) {
    if (typeof response === 'string' && ((response.includes('DOCTYPE html')) || (response.includes('doctype html')) || response.includes('unauthorized'))) {
      await dc.context.sendActivity(this.lgFile.evaluate('APIErrorText', dc.context.activity));
      return true;
    }
    return false;
  }


}

module.exports.ProductionDialog = ProductionDialog;
