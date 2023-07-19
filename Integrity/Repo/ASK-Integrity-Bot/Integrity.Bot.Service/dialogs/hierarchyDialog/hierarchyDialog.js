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
const { sendTypingIndicator, hierarchyDetailsTable } = require('../../core/commons/utils');

const DIALOG_ID = 'HIERARCHY_DIALOG';
const ALLOW_INTERRUPTS = ['Help', 'StartOver', 'ChangeAgent', 'Commission'];

const {
  getCarriersForAgentAPI,
  getContractDetailsForAgentAPI,
  getHierarchyDetailsAPI
} = require('./hierarchyDialogAPIs');

/**
 * This dialog is used to extract agent contracts
 */
class HierarchyDialog extends ComponentDialog {
  userState;
  lgFile;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'hierarchyDialog.lg'));

    // Custom function to detect and navigate to interrupts
    Expression.functions.add('ifHierarchyDialogInterrupts', (args) => {
      // console.log('\nturn.recognized: ', args[0]);
      for (let i = 0; i < ALLOW_INTERRUPTS.length; i++) {
        if (args[0][ALLOW_INTERRUPTS[i]] && args[0][ALLOW_INTERRUPTS[i]].score >= 0.8) {
          return true;
        }
      }
      if (args[1] && args[1].toLowerCase() === 'hierarchy info') {
        return true;
      }
      return false;
    });

    // Main Contract Dialog
    const hierarchyDialog = new AdaptiveDialog(DIALOG_ID).configure({
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
              allowInterruptions: new BoolExpression('=ifHierarchyDialogInterrupts(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
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
              allowInterruptions: new BoolExpression('=ifHierarchyDialogInterrupts(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
              disabled: new BoolExpression('!dialog.promptForEmptyCarrier')
            }
          ),
          new CodeAction(this.handleCarrierPrompt.bind(this)),

          // Prompts User for choose Contracts if more 1 contracts is associated with chosen Carrier
          new TextInput().configure(
            {
              property: new StringExpression('turn.contract'),
              prompt: new ActivityTemplate('${AskForContractPrompt()}'),
              // validations: ['(turn.recognized.entities.product[0][0] != null)'], // Handle this for Issue2
              allowInterruptions: new BoolExpression('=ifHierarchyDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForContract')
            }
          ),
          new CodeAction(this.handleContractPrompt.bind(this)),

          // Prompts User for ProductType when given wrong ProductType provided in initial Utterance
          // new TextInput().configure(
          //     {
          //         property: new StringExpression('turn.validProductType'),
          //         prompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
          //         validations: ['(turn.recognized.entities.product[0][0] != null)'],
          //         invalidPrompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
          //         allowInterruptions: new BoolExpression('=ifHierarchyDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
          //         disabled: new BoolExpression('!dialog.promptForInvalidProductType')
          //     }
          // ),
          // new CodeAction(this.handleInvalidProductTypePrompt.bind(this)),

          // Prompts User for ProductType when ProductType not provided in initial Utterance or When Products > 10 for Chooses Carrier and Contract
          // new TextInput().configure(
          //     {
          //         property: new StringExpression('turn.productType'),
          //         prompt: new ActivityTemplate('${AskProductTypePrompt()}'),
          //         validations: ['(turn.recognized.entities.product[0][0] != null)'],
          //         invalidPrompt: new ActivityTemplate('${AskInvalidProductTypeDropdownPrompt()}'),
          //         allowInterruptions: new BoolExpression('=ifHierarchyDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
          //         disabled: new BoolExpression('!dialog.promptForEmptyProductType')
          //     }
          // ),
          // new CodeAction(this.handleProductTypePrompt.bind(this)),

          // Prompt User if they needs check Contracts for other Carriers(Restart Flow) or Close the Contract flow
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

          // End the hierarchy flows and start other flows
          new IfCondition().configure({
            condition: new BoolExpression('dialog.endFlow'),
            actions: [
              new IfCondition().configure({
                condition: new BoolExpression('conversation.hierarchyObj.subflow == "toh"'),
                actions: [
                  new SendActivity('${InitiateOtherFlowTextToh()}'),
                  new EndDialog()
                ]
              }),
              new IfCondition().configure({
                condition: new BoolExpression('conversation.hierarchyObj.subflow == "ImmediateUpline"'),
                actions: [
                  new SendActivity('${InitiateOtherFlowTextImmediateUpline()}'),
                  new EndDialog()
                ]
              }),
              new IfCondition().configure({
                condition: new BoolExpression('conversation.hierarchyObj.subflow == "downlineCount"'),
                actions: [
                  new SendActivity('${InitiateOtherFlowTextDownlineCount()}'),
                  new EndDialog()
                ]
              }),
              new IfCondition().configure({
                condition: new BoolExpression('!conversation.hierarchyObj.subflow'),
                actions: [
                  new SendActivity('${InitiateOtherFlowText()}'),
                  new EndDialog()
                ]
              })
            ]
          }),

          // Restart the Hierarchy dialog and prompt User for Carrier Dropdown
          new IfCondition().configure({
            condition: new BoolExpression('turn.restartFlow'),
            actions: [
              new RepeatDialog()
            ]
          })
        ])
      ]
    });

    this.addDialog(hierarchyDialog);
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

  /**
   * Handle end flow
   * @param {*} dc
   */
  async endFlow(dc) {
    dc.state.setValue('dialog.endFlow', true);
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
   * Update hierarchyObj with carrier name, contractId, productType and subFlow
   * @param {*} dc
   * @param {*} carrierName
   * @param {*} contractId
   * @param {*} productType
   * @param {*} reset
   */
  async updateContext(dc, carrierName = null, contractId = null, productType = null, reset = null) {
    const hierarchyObj = reset ? {} : dc.state.getValue('conversation.hierarchyObj');
    if (carrierName) hierarchyObj.carrierName = carrierName;
    if (contractId) hierarchyObj.contractId = contractId;
    // if (productType) hierarchyObj.productType = productType;
    if (!hierarchyObj.subFlow && dc.state.getValue('conversation.hierarchyObj').subFlow) {
      hierarchyObj.subFlow = dc.state.getValue('conversation.hierarchyObj').subFlow;
    }
    // console.log('updateContext - hierarchyObj: ', hierarchyObj);
    dc.state.setValue('conversation.hierarchyObj', hierarchyObj);
  }

  /**
   * Used to extract date
   * @param {*} date
   * @returns
   */
  extractDate(date) {
    return moment(date).format('MM/DD/YYYY');
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
    const hierarchyObj = dc.state.getValue('conversation.hierarchyObj');
    if (hierarchyObj.carrierName) {
      params.carrierName = hierarchyObj.carrierName;
    }
    if (hierarchyObj.contractId) {
      params.contractId = hierarchyObj.contractId;
    }

    // if (hierarchyObj.subFlow === 'awn' || hierarchyObj.subFlow === 'payout') {
    //     params.subFlow = hierarchyObj.subFlow;
    // }
    return params;
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
   * This method gets contract details for a agent from API and handles different scenarios
   * @param {*} dc
   * @returns
   */
  async handleContractDetailsFlow(dc) {
    console.log('hierarchy flow: handleContractDetailsFlow');

    const agentPayout = await this.getContractsForAgents(dc);
    if (agentPayout === null || !agentPayout.contractDetails) return; // API Error in fetching data

    if (agentPayout.contractDetails.length === 0) {
      return await this.displayRestartFlowCard(dc, this.lgFile.evaluate('NoContractDetailsText', dc.context.activity));
    }

    if (agentPayout.contractDetails.length > 1) {
      return await this.displayContractsForAgent(dc, agentPayout);
    } else {
      await this.updateContext(dc, null, agentPayout.contractDetails[0].contractId);
    }

    const hierarchyObj = dc.state.getValue('conversation.hierarchyObj');

    if (hierarchyObj.subFlow === 'toh') {
      return await this.displayTopofHierarchyOnly(dc);
    }

    if (hierarchyObj.subFlow === 'ImmediateUpline') {
      return await this.displayImmediateUplineOnly(dc);
    }

    if (hierarchyObj.subFlow === 'downlineCount') {
      return await this.displayDownlineCountOnly(dc);
    }

    return await this.displayHierarchyDetails(dc);
  }

  // Display Components

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

    const hierarchyObj = dc.state.getValue('conversation.hierarchyObj');
    message = 'Do you want to look at different ';
    if (hierarchyObj && hierarchyObj.subFlow) { // Change the message based on subFlow
      if (hierarchyObj.subFlow === 'ImmediateUpline') {
        message = 'Do you want to look at immediate upline for different carriers ';
      } else if (hierarchyObj.subFlow === 'toh') {
        message = 'Do you want to look at Top of Hierarchy for different carriers ';
      } else if (hierarchyObj.subFlow === 'downlineCount') {
        message = 'Do you want to look at Downline Count for different carriers '
      }

    } else {
      message += 'carrier contract hierarchy ';
    }
    message += `for **${dc.state.getValue('conversation.displayAgent.name')}**?`;
    await dc.context.sendActivity(message);
    dc.state.setValue('dialog.promptForRestart', true);
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
   * This method is used to display contract prompt (Carousel card or Contract dropdown)
   * @param {*} dc
   * @param {*} agentPayout
   * @returns
   */
  async displayContractsForAgent(dc, agentPayout) {
    console.log('contract flow: displayContractsForAgent');

    const hierarchyObj = dc.state.getValue('conversation.hierarchyObj');
    let message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentPayout.contractDetails.length} contracts for ${hierarchyObj.carrierName}.`;
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
   * This method is used to display contract details to users based on different scenarios
   * @param {*} dc
   */
  async displayHierarchyDetails(dc) {
    console.log('displayHierarchyDetails');
    const params = await this.exactParamsForAPI(dc);
    const hierarchyDetails = await getHierarchyDetailsAPI(params);

    const hierarchyObj = dc.state.getValue('conversation.hierarchyObj');
    let message = `The hierarchy information for ${dc.state.getValue('conversation.displayAgent.name')}'s ${hierarchyObj.carrierName} Contract is ${hierarchyDetails.hierarchyList ? ':' : 's'}`;

    let hierarchyData;
    console.log('heirarchy object', hierarchyDetails.hierarchyList);
    if (!hierarchyDetails.hierarchyList || hierarchyDetails.hierarchyList.length === 0) {
      message += '\n are not available';
    } else {
      hierarchyData = await hierarchyDetailsTable(hierarchyDetails, params.agentId);
    }

    await dc.context.sendActivity(message);

    if (hierarchyData) await dc.context.sendActivity(hierarchyData);

    await this.displayRestartFlowCard(dc);
  }

  // Handler Methods
  /**
   * Acts as starting point of contract flow and extracts initial information's
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async handleInit(dc, options) {
    console.log('hierarchy flow: handleInit');
    console.log('turn.showCarrierName:', dc.state.getValue('turn'));
    //console.log('turn.showProductType', dc.state.getValue('turn.showProductType'));

    const restartFlow = dc.state.getValue('turn.restartFlow');
    if (restartFlow) {
      // await this.resetContext(dc);
      await this.updateContext(dc, null, null, null, true);
    }

    const hierarchyObj = dc.state.getValue('conversation.hierarchyObj');
    let agentCarriers = await this.getCarriersForAgent(dc);
    console.log('AGENTCarriers', agentCarriers);
    if (!agentCarriers) { // API Error in fetching data
      return dc.endDialog();
    }

    let message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active carriers`;
    if (restartFlow) {
      message = `${dc.state.getValue('conversation.displayAgent.name')} has other contracts across carriers.`;
    }
    if (hierarchyObj.carrierName) {
      if (agentCarriers.length === 1) { // Handle Payout details
        await this.handleContractDetailsFlow(dc);
        return dc.endDialog();
      }
      if (agentCarriers.length > 1) { // Handle when more than 1 carrier present for given input(Carrier or Payout)
        if (hierarchyObj.carrierName) {
          message += ` for ${hierarchyObj.carrierName}.`;
        }
      } else { // Handle when 0 carrier present for given input(Carrier or Payout)
        let subMessage = null;
        if (hierarchyObj.carrierName) { // Clear Carrier from Context
          subMessage = ` for ${hierarchyObj.carrierName}`;
          const carrierName = hierarchyObj.carrierName[0]
          dc.state.setValue('turn.showCarrierName', carrierName);
          hierarchyObj.carrierName = null;
        }

        // if (hierarchyObj.productType) { // Clear Product Type from Context
        //     if (subMessage) {
        //         subMessage += ' and ';
        //     } else {
        //         subMessage += ' for ';
        //     }
        //     subMessage += ` ${ hierarchyObj.productType }`;
        //     dc.state.setValue('turn.showProductType', hierarchyObj.productType);
        //     hierarchyObj.productType = null;
        // }
        // dc.state.setValue('conversation.hierarchyObj', hierarchyObj);

        agentCarriers = await this.getCarriersForAgent(dc);
        if (!agentCarriers) { // API Error in fetching data
          return dc.endDialog();
        }
        if (agentCarriers.length === 0) { // If no Carrier exist for Agent
          message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active contracts`;
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
      await dc.context.sendActivity(`${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active contracts.`);
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
    await this.handleContractDetailsFlow(dc); // Handle Payout details
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
    await this.handleContractDetailsFlow(dc); // Handle Payout details
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
    await this.handleContractDetailsFlow(dc); // Handle Payout details
    return dc.endDialog();
  }

  // /**
  //  * Validation for if product type (if provided in the initial utterance is invalid and selected from the dropdown)
  //  * @param {*} dc
  //  * @param {*} options
  //  * @returns
  //  */
  // async handleInvalidProductTypePrompt(dc, options) {
  //     if (!dc.state.getValue('dialog.promptForInvalidProductType')) {
  //         return dc.endDialog();
  //     }

  //     console.log('contract flow: handleInvalidProductTypePrompt');
  //     dc.state.setValue('dialog.promptForInvalidProductType', false);

  //     await this.updateContext(dc, null, null, dc.state.getValue('turn.validProductType'));
  //     await this.handleContractDetailsFlow(dc); // Handle Payout details
  //     return dc.endDialog();
  // }

  /**
  //  * Validation for product type
  //  * @param {*} dc
  //  * @param {*} options
  //  * @returns
   */
  // async handleProductTypePrompt(dc, options) {
  //     if (!dc.state.getValue('dialog.promptForEmptyProductType')) {
  //         return dc.endDialog();
  //     }

  //     console.log('contract flow: handleProductTypePrompt');
  //     dc.state.setValue('dialog.promptForEmptyProductType', false);

  //     await this.updateContext(dc, null, null, dc.state.getValue('turn.productType'));
  //     await this.handleContractDetailsFlow(dc); // Handle Payout details
  //     return dc.endDialog();
  // }

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
   * This method is used to display immediate ImmediateUpline
   * @param {*} dc
   * @returns
   */
  async displayImmediateUplineOnly(dc) {
    const params = await this.exactParamsForAPI(dc);
    const hierarchyDetails = await getHierarchyDetailsAPI(params);
    const agentName = dc.state.getValue('conversation.displayAgent.name');
    const { carrierName } = dc.state.getValue('conversation.hierarchyObj');
    const { name, agentId, awnNumber } = hierarchyDetails.hierarchyList[0].hierarchy.immediateUpline;
    const contractId = hierarchyDetails.hierarchyList[0].hierarchy.immediateUpline.contractId;
    const awnText = awnNumber ? `(${awnNumber})` : '';
    const urlText = `${name} ${awnText}`;
    const url = `agents/${agentId}/contracts/details/${contractId}`
    // const url = `agents/${ agentId }/contracts`;
    const message = `The Immediate upline for ${agentName}'s ${carrierName} contract is **[${urlText}](${url})**.`;
    await dc.context.sendActivity(message);
    await this.displayRestartFlowCard(dc);
  }

  /**
   * This method is used to display Top Of Hierarchy Details
   * @param {*} dc
   * @returns
   */
  async displayTopofHierarchyOnly(dc) {
    const params = await this.exactParamsForAPI(dc);
    const hierarchyDetails = await getHierarchyDetailsAPI(params);
    const agentName = dc.state.getValue('conversation.displayAgent.name');
    const { carrierName } = dc.state.getValue('conversation.hierarchyObj');
    const { name, agentId, awnNumber } = hierarchyDetails.hierarchyList[0].hierarchy.toh;
    const contractId = hierarchyDetails.hierarchyList[0].hierarchy.toh.contractId;
    const awnText = awnNumber ? `(${awnNumber})` : '';
    const urlText = `${name} ${awnText}`;
    const url = `agents/${agentId}/contracts/details/${contractId}`
    // const url = `agents/${ agentId }/contracts`;
    const message = `The Top of Hierarchy for ${agentName}'s ${carrierName} contract is **[${urlText}](${url})**.`;
    await dc.context.sendActivity(message);
    await this.displayRestartFlowCard(dc);
  }

  /**
   * This method is used to display Top Of Hierarchy Details
   * @param {*} dc
   * @returns
   */
  async displayDownlineCountOnly(dc) {
    const params = await this.exactParamsForAPI(dc);
    const hierarchyDetails = await getHierarchyDetailsAPI(params);
    const agentName = dc.state.getValue('conversation.displayAgent.name');
    const agentId = dc.state.getValue('conversation.displayAgent.agentId');
    const { carrierName } = dc.state.getValue('conversation.hierarchyObj');
    const { downlineCount } = hierarchyDetails.hierarchyList[0].hierarchy;
    const contractId = hierarchyDetails.hierarchyList[0].contractId;
    const urlText = `${downlineCount}`;
    const url = `agents/${agentId}/contracts/details/${contractId}`;
    // const url = `agents/${ agentId }/contracts`;
    const message = `The downline count for ${agentName}'s ${carrierName} contract is **[${urlText}](${url})**.`;
    await dc.context.sendActivity(message);
    await this.displayRestartFlowCard(dc);
  }
}

module.exports.HierarchyDialog = HierarchyDialog;
