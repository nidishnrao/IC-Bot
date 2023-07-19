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
  SendActivity
} = require('botbuilder-dialogs-adaptive');
const { StringExpression, BoolExpression, Expression } = require('adaptive-expressions');
const { Templates } = require('botbuilder-lg');
const moment = require('moment');

const { getData } = require('../../core/accessors/sessionManagement');
const { sendTypingIndicator, productLevelTable, awnDetailsTable, onlyAWNCard } = require('../../core/commons/utils');

const DIALOG_ID = 'CONTRACT_DIALOG';
const ALLOW_INTERRUPTS = ['Help', 'StartOver', 'ChangeAgent', 'Commission'];

const {
  getCarriersForAgentAPI,
  getContractDetailsForAgentAPI,
  getProductTypeForAgentAPI
} = require('./contractDialogAPIs');
const { getStatusCard } = require('../../bots/resources/adaptive-cards');

/**
 * This dialog is used to extract agent contracts
 */
class ContractDialog extends ComponentDialog {
  userState;
  lgFile;
  dropdownproduct = false;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'contractDialog.lg'));

    // Custom function to detect and navigate to interrupts
    Expression.functions.add('ifContractDialogInterrupts', (args) => {
      // console.log('\nturn.recognized: ', args[0]);
      for (let i = 0; i < ALLOW_INTERRUPTS.length; i++) {
        if (args[0][ALLOW_INTERRUPTS[i]] && args[0][ALLOW_INTERRUPTS[i]].score >= 0.8) {
          return true;
        }
      }
      if (args[1] && args[1].toLowerCase() === 'contract info') {
        return true;
      }
      return false;
    });

    // Main Contract Dialog
    const contractDialog = new AdaptiveDialog(DIALOG_ID).configure({
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
              allowInterruptions: new BoolExpression('=ifContractDialogInterrupts(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
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
              allowInterruptions: new BoolExpression('=ifContractDialogInterrupts(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
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
              allowInterruptions: new BoolExpression('=ifContractDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
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
              allowInterruptions: new BoolExpression('=ifContractDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
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
              allowInterruptions: new BoolExpression('=ifContractDialogInterrupts(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForEmptyProductType')
            }
          ),
          new CodeAction(this.handleProductTypePrompt.bind(this)),

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

          // End the contract flows and start other flows
          new IfCondition().configure({
            condition: new BoolExpression('dialog.endFlow'),
            actions: [
              new SendActivity('${InitiateOtherFlowText()}')
            ]
          }),

          // Restart the Contract dialog and prompt User for Carrier Dropdown
          new IfCondition().configure({
            condition: new BoolExpression('turn.restartFlow'),
            actions: [
              new RepeatDialog()
            ]
          })
        ])
      ]
    });

    this.addDialog(contractDialog);
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
   * Update contractObj with carrier name, contractId, productType and subFlow
   * @param {*} dc
   * @param {*} carrierName
   * @param {*} contractId
   * @param {*} productType
   * @param {*} reset
   */
  async updateContext(dc, carrierName = null, contractId = null, productType = null, reset = null) {
    const contractObj = reset ? {} : dc.state.getValue('conversation.contractObj');
    if (carrierName) contractObj.carrierName = carrierName;
    if (contractId) contractObj.contractId = contractId;
    if (productType) contractObj.productType = productType;
    if (!contractObj.subFlow && dc.state.getValue('conversation.contractObj').subFlow) {
      contractObj.subFlow = dc.state.getValue('conversation.contractObj').subFlow;
    }
    // console.log('updateContext - contractObj: ', contractObj);
    dc.state.setValue('conversation.contractObj', contractObj);
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
    const contractObj = dc.state.getValue('conversation.contractObj');
    if (contractObj.carrierName) {
      params.carrierName = contractObj.carrierName;
    }
    if (contractObj.contractId) {
      params.contractId = contractObj.contractId;
    }
    if (contractObj.productType) {
      params.productType = contractObj.productType;
    }

    if (contractObj.subFlow === 'awn' || contractObj.subFlow === 'payout' || contractObj.subFlow === 'status') {
      params.subFlow = contractObj.subFlow;
    }
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
   * This method gets contract details for a agent from API and handles different scenarios
   * @param {*} dc
   * @returns
   */
  async handleContractDetailsFlow(dc) {
    console.log('contract flow: handleContractDetailsFlow');

    const agentPayout = await this.getContractsForAgents(dc);
    if (agentPayout === null) return; // API Error in fetching data

    if (agentPayout.contractDetails.length === 0) {
      return await this.displayRestartFlowCard(dc, this.lgFile.evaluate('NoContractDetailsText', dc.context.activity));
    }

    if (agentPayout.contractDetails.length > 1) {
      return await this.displayContractsForAgent(dc, agentPayout);
    }

    const contractObj = dc.state.getValue('conversation.contractObj');
    if (contractObj.subFlow === 'awn') {
      return await this.displayAWNsOnly(dc, agentPayout.contractDetails[0]);
    }

    if (contractObj.subFlow === 'payout') {
      return await this.displayPayoutLevelsOnly(dc, agentPayout.contractDetails[0]);
    }

    if (contractObj.subFlow === 'status') {
      return await this.displayContractStatusOnly(dc, agentPayout.contractDetails[0]);
    }


    return await this.displayContractDetails(dc, agentPayout.contractDetails[0]);

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

    const contractObj = dc.state.getValue('conversation.contractObj');
    message = 'Do you want to look at ';
    if (contractObj && contractObj.subFlow) { // Change the message based on subFlow
      if (contractObj.subFlow === 'awn') {
        message += 'different AWNs ';
      } else if (contractObj.subFlow === 'payout') {
        message += 'different payout levels ';
      } else if (contractObj.subFlow === 'status') {
        message += 'Contract Status for different carriers '
      }

    } else {
      message += 'different carrier contracts ';
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

    const contractObj = dc.state.getValue('conversation.contractObj');
    let message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentPayout.contractDetails.length} contracts for ${contractObj.carrierName}.`;
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
   * This method is used to display AWN card
   * @param {*} dc
   * @param {*} contractDetails
   */
  async displayAWNsOnly(dc, contractDetails) {
    const contractObj = dc.state.getValue('conversation.contractObj');
    let message = `Sorry, ${dc.state.getValue('conversation.displayAgent.name')} doesn't have AWN for ${contractObj.carrierName}.`;
    let AWNData;

    if (contractDetails.awnDetails.length > 1) {
      message = `Writing number for **${dc.state.getValue('conversation.displayAgent.name')}'s** **${contractObj.carrierName}** contract selected:`;
      AWNData = await onlyAWNCard(contractDetails);
    } else if (contractDetails.awnDetails.length === 1) {
      let awn = `${contractDetails.awnDetails[0].awnNumber}`;
      if (contractDetails.awnDetails[0].isWritable) {
        awn += ' (Writable)';
      } else {
        awn += ' (Not Writable)';
      }
      message = `Writing number for **${dc.state.getValue('conversation.displayAgent.name')}'s** **${contractObj.carrierName}** contract is **${awn}**.`;
    }

    await dc.context.sendActivity(message);
    if (AWNData) await dc.context.sendActivity(AWNData);
    await this.displayRestartFlowCard(dc);
  }

  /**
   * This method is used to display Payout Level details
   * @param {*} dc
   * @param {*} contractDetails
   */
  async displayPayoutLevelsOnly(dc, contractDetails) {
    console.log('displayPayoutLevelsOnly -> contractDetails: ', JSON.stringify(contractDetails));

    const contractObj = dc.state.getValue('conversation.contractObj');
    let message = `Sorry, ${dc.state.getValue('conversation.displayAgent.name')} doesn't have payout level details for ${contractObj.carrierName}`;
    if (contractObj.productType) {
      message = message + ` for ${contractObj.productType}.`
    } else {
      message = message + `.`
    }
    let payoutData;
    if (contractDetails.productDetails.length === 0) {
      await dc.context.sendActivity(message);
    }
    if (contractDetails.productDetails.length > 1) {
      if (contractDetails.productDetails.length < 10) {
        message = `${dc.state.getValue('conversation.displayAgent.name')}'s payout level for ${contractObj.carrierName}`;
        if (contractObj.productType) {
          message += `${contractObj.productType} is:`
        }
        await dc.context.sendActivity(message);

      }

      await this.displayPayoutDetails(dc);
      return;
      // if (contractDetails.productDetails.length > 10) { // check product > 10 show product dropdown
      //   const agentProductTypes = await this.getProductTypesForAgents(dc);

      //   if (agentProductTypes === null) return; // API Error in fetching data

      //   if (!contractObj.productType) {
      //     await this.displayProductTypeDropdown(dc, agentProductTypes);
      //   } else {
      //     this.displayProductTable(dc);
      //   }
      // } else {
      //   message = ` ${dc.state.getValue('conversation.displayAgent.name')}'s payout level for ${contractObj.carrierName} `;
      //   if (contractObj.productType) {
      //     message = message + `${contractObj.productType} is:`
      //   }

      // }

      // payoutData = await productLevelTable(contractDetails);
    } else if (contractDetails.productDetails.length === 1) {
      message = `${dc.state.getValue('conversation.displayAgent.name')}'s payout level for ${contractObj.carrierName} `;
      if (contractObj.productType) {
        message = message + `${contractObj.productType}`;
      }
      message = message + ` product **${contractDetails.productDetails[0].productName} is ${contractDetails.productDetails[0].level}**.`;
      await dc.context.sendActivity(message);
    }



    // await dc.context.sendActivity(message);
    if (payoutData) await dc.context.sendActivity(payoutData);
    await this.displayRestartFlowCard(dc);
  }




  /**
   * This method is used to display Contract Status details
   * @param {*} dc
   * @param {*} contractDetails
   */
  async displayContractStatusOnly(dc, { status, statusReason, startDate }, contractDetails) {
    console.log('displayContractStatusOnly -> contractDetails: ', JSON.stringify(contractDetails));

    const contractObj = dc.state.getValue('conversation.contractObj');
    console.log(contractObj)
    const startDate1 = this.extractDate(startDate);
    let message = `${dc.state.getValue('conversation.displayAgent.name')}'s ${contractObj.carrierName} contract status is:  \n**${status} (${statusReason})**  \n**Effective: ${startDate1}**`;

    await dc.context.sendActivity(message);

    await this.displayRestartFlowCard(dc);
  }




  /**
   * This method is used to display contract details to users based on different scenarios
   * @param {*} dc
   * @param {*} contractDetails
   */
  async displayContractDetails(dc, contractDetails) {
    console.log('displayContractDetails');
    const contractObj = dc.state.getValue('conversation.contractObj');

    if (!contractDetails.awnDetails.length && !contractDetails.productDetails.length) {
      const startDate = this.extractDate(contractDetails.startDate);
      let message = ` I found ${contractObj.carrierName} contract status  \n**${contractDetails.status} (${contractDetails.statusReason})**  \n**Effective: ${startDate}**`;
      await dc.context.sendActivity(message);
      message = `Sorry, ${dc.state.getValue('conversation.displayAgent.name')} doesn't have Payout and AWN details for the selected Contract.`;
      await dc.context.sendActivity(message);
      await this.displayRestartFlowCard(dc);
      return;
    }

    if (contractDetails.awnDetails.length && !contractDetails.productDetails.length) {
      await this.displayAWNDetails(dc);
      await this.displayRestartFlowCard(dc);
      return;
    }

    if (!contractDetails.awnDetails.length && contractDetails.productDetails.length) {
      await this.displayPayoutDetails(dc);
      return;
    }

    await this.displayAWNDetails(dc);
    await this.displayPayoutDetails(dc);

  }

  async displayAWNDetails(dc) {
    const agentPayout = await this.getContractsForAgents(dc);
    const contractDetails = agentPayout.contractDetails[0];
    const awnData = await awnDetailsTable(contractDetails);
    const contractObj = dc.state.getValue('conversation.contractObj');
    let awnMsg = `Contract details for ${contractObj.carrierName}`;

    if (contractObj.productType) {
      awnMsg += ` for ${contractObj.productType}`;
    }

    if (!contractDetails.productDetails.length) {
      awnMsg += ` (Payout details are not available)`;
    }

    await dc.context.sendActivity(awnMsg);

    await dc.context.sendActivity(awnData);
  }
  //  /Function for payout subflow due to text change
  // async displayPayoutDetailsSubflow(dc){
  //   const agentPayout = await this.getContractsForAgents(dc);
  //   const contractDetails = agentPayout.contractDetails[0];
  //   const contractObj = dc.state.getValue('conversation.contractObj');
  //   dc.state.setValue('conversation.carrierName', contractObj.carrierName);
  //   let payoutMsg = '';

  //   if (contractDetails.productDetails.length > 10) { // check product > 10 show product dropdown
  //     const agentProductTypes = await this.getProductTypesForAgents(dc);

  //     if (agentProductTypes === null) return; // API Error in fetching data

  //     if (!contractObj.productType) {
  //       await this.displayProductTypeDropdown(dc, agentProductTypes);
  //     } else {
  //       this.displayProductTableSubflow(dc);
  //     }
  //   } else {
  //     await this.displayProductTableSubflow(dc);
  //   }
  // }
  // //  /Function for payout subflow due to text change
  // async displayProductTableSubflow(dc) {
  //   const contractObj = dc.state.getValue('conversation.contractObj');
  //   const agentPayout = await this.getContractsForAgents(dc);
  //   const contractDetails = agentPayout.contractDetails[0];

  //   if (this.dropdownproduct) {
  //     let payoutMsg = `${dc.state.getValue('conversation.displayAgent.name')}'s payout levels for`;

  //     if (contractObj.productType) {
  //       payoutMsg += ` **${contractObj.carrierName}, ${contractObj.productType}**:`;
  //     } else {
  //       payoutMsg += ` **${contractObj.carrierName}**:`;
  //     }

  //     await dc.context.sendActivity(payoutMsg);
  //   }
  //   const productsData = await productLevelTable(contractDetails);

  //   await dc.context.sendActivity(productsData);

  //   await this.displayRestartFlowCard(dc);
  // }

  async displayPayoutDetails(dc) {
    const agentPayout = await this.getContractsForAgents(dc);
    const contractDetails = agentPayout.contractDetails[0];
    const contractObj = dc.state.getValue('conversation.contractObj');
    dc.state.setValue('conversation.carrierName', contractObj.carrierName);
    let payoutMsg = '';

    if (!contractDetails.awnDetails.length && contractObj.subFlow !== 'payout') {
      payoutMsg = `Contract details for ${contractObj.carrierName}:\n(AWN details are not available)`;
      await dc.context.sendActivity(payoutMsg);
      const startDate = this.extractDate(contractDetails.startDate);
      payoutMsg = ` I found ${contractObj.carrierName} contract status  \n**${contractDetails.status} (${contractDetails.statusReason})**  \n**Effective: ${startDate}**`;
      await dc.context.sendActivity(payoutMsg);
    }



    if (contractDetails.productDetails.length > 10) { // check product > 10 show product dropdown
      const agentProductTypes = await this.getProductTypesForAgents(dc);

      if (agentProductTypes === null) return; // API Error in fetching data

      if (!contractObj.productType) {
        await this.displayProductTypeDropdown(dc, agentProductTypes);
      } else {
        this.displayProductTable(dc);
      }
    } else {
      await this.displayProductTable(dc);
    }

  }

  async displayProductTable(dc) {
    const contractObj = dc.state.getValue('conversation.contractObj');
    const agentPayout = await this.getContractsForAgents(dc);
    const contractDetails = agentPayout.contractDetails[0];
    let payoutMsg;
    if (this.dropdownproduct) {
      if (contractObj.subFlow === 'payout') {
        payoutMsg = `${dc.state.getValue('conversation.displayAgent.name')}'s payout level for`;
      } else {
        payoutMsg = `${dc.state.getValue('conversation.displayAgent.name')}'s payout details for`;
      }


      if (contractObj.productType) {
        payoutMsg += ` **${contractObj.carrierName}, ${contractObj.productType}**:`;
      } else {
        payoutMsg += ` **${contractObj.carrierName}**:`;
      }

      await dc.context.sendActivity(payoutMsg);
    }
    const productsData = await productLevelTable(contractDetails);

    await dc.context.sendActivity(productsData);

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
    this.dropdownproduct = false;
    console.log('contract flow: handleInit');

    const restartFlow = dc.state.getValue('turn.restartFlow');
    if (restartFlow) {
      // await this.resetContext(dc);
      await this.updateContext(dc, null, null, null, true);
    }

    const contractObj = dc.state.getValue('conversation.contractObj');
    let agentCarriers = await this.getCarriersForAgent(dc);
    if (!agentCarriers) { // API Error in fetching data
      return dc.endDialog();
    }

    let message = `${dc.state.getValue('conversation.displayAgent.name')} has ${agentCarriers.length} active carriers`;
    if (restartFlow) {
      message = `${dc.state.getValue('conversation.displayAgent.name')} has other contracts across carriers.`;
    }
    if (contractObj.carrierName || contractObj.productType) {
      if (agentCarriers.length === 1) { // Handle Payout details
        await this.handleContractDetailsFlow(dc);
        return dc.endDialog();
      }
      if (agentCarriers.length > 1) { // Handle when more than 1 carrier present for given input(Carrier or Payout)
        if (contractObj.carrierName) {
          message += ` for ${contractObj.carrierName}.`;
        }
      } else { // Handle when 0 carrier present for given input(Carrier or Payout)
        let subMessage = null;
        if (contractObj.carrierName) { // Clear Carrier from Context
          subMessage = ` for ${contractObj.carrierName}`;
          dc.state.setValue('turn.showCarrierName', contractObj.carrierName);
          contractObj.carrierName = null;
        }

        if (contractObj.productType) { // Clear Product Type from Context
          if (subMessage) {
            subMessage += ' and ';
          } else {
            subMessage += ' for ';
          }
          subMessage += ` ${contractObj.productType}`;
          dc.state.setValue('turn.showProductType', contractObj.productType);
          contractObj.productType = null;
        }
        dc.state.setValue('conversation.contractObj', contractObj);

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
    await this.handleContractDetailsFlow(dc); // Handle Payout details
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
    this.dropdownproduct = true;
    await this.displayProductTable(dc); // Handle Payout details
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
}

module.exports.ContractDialog = ContractDialog;
