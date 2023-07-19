const path = require('path');
const { ComponentDialog } = require('botbuilder-dialogs');
const {
  AdaptiveDialog,
  CodeAction,
  LuisAdaptiveRecognizer,
  SetProperties,
  TemplateEngineLanguageGenerator,
  OnBeginDialog,
  IfCondition,
  SendActivity,
  EndDialog,
  ActivityTemplate,
  TextInput,
  DeleteProperty,
  SwitchCondition,
  Case,
  BeginDialog,
  RepeatDialog
} = require('botbuilder-dialogs-adaptive');
const { StringExpression, ValueExpression, BoolExpression, Expression } = require('adaptive-expressions');
const { Templates } = require('botbuilder-lg');
const moment = require('moment');

const { getData } = require('../../core/accessors/sessionManagement');
const { API_VERSION } = require('../../core/commons/config');

const {
  getPolicyLookupStatusAPI,
  getPolicyCommissionDetailsAPI
} = require('./policyLookupDialogAPI');

const {
  getAxiosReq,
  sendTypingIndicator,
  policyLookupStatusDetailsTable,
  policyCommissionDetailsTable
} = require('../../core/commons/utils');

const DIALOG_ID = 'POLICY_LOOKUP_DIALOG';
const POLICY_ENTITIES_DIALOG_ID = 'POLICY_ENTITIES_DIALOG';
class PolicyLookupDialog extends ComponentDialog {
  userState;
  lgFile;
  generatorTemplate;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'policyLookupDialog.lg'));
    this.generatorTemplate = new TemplateEngineLanguageGenerator(this.lgFile);

    // Custom function for interrupt
    Expression.functions.add('checkForInterrupt', (args) => {
      console.log('\nturn.recognized: ', args[0]);
      if ((args[0].Help && args[0].Help.score >= 0.8) || (args[0].StartOver && args[0].StartOver.score >= 0.8)) {
        return true;
      }
      return false;
    });

    // Policy Lookup  dialog triggers
    const policyLookupDialog = new AdaptiveDialog(DIALOG_ID).configure({
      generator: this.generatorTemplate, // new TemplateEngineLanguageGenerator(this.lgFile),
      recognizer: this.createLuisRecognizer(),
      triggers: [
        new OnBeginDialog([
          new CodeAction(this.handleInit.bind(this)),

          new BeginDialog(POLICY_ENTITIES_DIALOG_ID),

          new CodeAction(this.displayPolicyDetails.bind(this)),

          // Prompt User if they needs check Contracts for other Carriers(Restart Flow) or Close the Contract flow
          new TextInput().configure(
            {
              property: new StringExpression('turn.needRestart'),
              prompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
              validations: ['(turn.recognized.entities.yes != null) || (turn.recognized.entities.no != null)'],
              invalidPrompt: new ActivityTemplate('${AskNeedRestartPrompt()}'),
              allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents, turn.recognized.text)'),
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

    const policyEntitiesInput = new AdaptiveDialog(POLICY_ENTITIES_DIALOG_ID).configure({
      generator: this.generatorTemplate,
      recognizer: this.createLuisRecognizer(),
      triggers: [
        new OnBeginDialog([
          // if policyNumber is not given in utterance / if policyNumber doesn't exists in DB / if policyID doesn't have any commissions 
          new TextInput().configure(
            {
              property: new StringExpression('turn.policyNumber'),
              alwaysPrompt: new BoolExpression(true),
              prompt: new ActivityTemplate('${AskPolicyNumberPrompt()}'),
              validations: ['length(this.value) > 1'],
              invalidPrompt: new ActivityTemplate('${InvalidPolicyNumberPrompt()}'),
              allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)'),
              disabled: new BoolExpression('!conversation.promptPolicyNumber')
            }
          ),

          new CodeAction(this.validatePolicyNumber.bind(this)),

          new TextInput().configure(
            {
              property: new StringExpression('turn.policyIdDropDown'),
              prompt: new ActivityTemplate('${AskPolicyIdPrompt()}'),
              allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents, turn.recognized.text)'),
              disabled: new BoolExpression('!dialog.promptForPolicyIdDropDown')
            }
          ),
          new CodeAction(this.validatePolicyId.bind(this)),

          new IfCondition().configure({
            condition: new BoolExpression('conversation.repeat'),
            actions: [
              new RepeatDialog()
            ]
          }),

          new EndDialog()
        ])
      ]
    });

    this.addDialog(policyLookupDialog);
    this.addDialog(policyEntitiesInput);
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

  async handleInit(dc) {
    await dc.context.sendActivity({ type: 'event', name: 'hideAgent' });
    dc.state.setValue('conversation.promptPolicyNumber', false);
    dc.state.setValue('conversation.invalidPolicyNumber', false);
    dc.state.setValue('conversation.invalidPolicyCommission', false);

    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');

    if (policyLookupObj.policyNumber === 'MODE' ||
        policyLookupObj.policyNumber === 'CARRIER' ||
        policyLookupObj.policyNumber === 'MARKETER' ||
        policyLookupObj.policyNumber === 'PLAN' ||
        policyLookupObj.policyNumber === 'PREMIUM' ||
        policyLookupObj.policyNumber === 'PRODUCT' ||
        policyLookupObj.policyNumber === 'AGENT' ||
        policyLookupObj.policyNumber === 'WRITING' ||
        policyLookupObj.policyNumber === 'NUMBER' ||
        policyLookupObj.policyNumber === 'ISSUED' ||
        policyLookupObj.policyNumber === 'ISSUE' ||
        policyLookupObj.policyNumber === 'ANNUAL') {
      policyLookupObj.policyNumber = null;
    }

    const restartFlow = dc.state.getValue('turn.restartFlow');
    if (!!restartFlow) {
      policyLookupObj = this.updateContext(dc, null, null, null, true);
    }

    if (!policyLookupObj.policyNumber) {
      dc.state.setValue('conversation.promptPolicyNumber', true);
    }

    return dc.endDialog();
  }

  /**
   * function to check if policyID has any commissions
   * @param {Object} dc
   * @returns
   */
  async validatePolicyId(dc) {
    if (dc.state.getValue('conversation.repeat')) {
      dc.state.setValue('conversation.promptPolicyNumber', true);
      this.updateContext(dc, null, null, null, true);
      return dc.endDialog();
    }

    const policyLookupObj = dc.state.getValue('conversation.policyLookupObj');

    if (!policyLookupObj.policyId) {
      this.updateContext(dc, null, null, dc.state.getValue('turn.policyIdDropDown'));
    }

    if (policyLookupObj.subFlow === 'policyCommission') {
      dc.state.setValue('conversation.repeat', true);
      dc.state.setValue('conversation.invalidPolicyCommission', true);
      dc.state.setValue('conversation.invalidPolicyNumber', false);
      dc.state.setValue('dialog.promptForPolicyIdDropDown', false);
      const params = await this.extractParamsForAPI(dc);
      const policyCommissionDetails = await getPolicyCommissionDetailsAPI(params);

      if (!!policyCommissionDetails.commissionDetails.length) {
        dc.state.setValue('conversation.repeat', false);
        dc.state.setValue('conversation.invalidPolicyCommission', false);
      } else {
        dc.state.setValue('conversation.promptPolicyNumber', true);
        this.updateContext(dc, null, null, null, true);
      }
    }

    return dc.endDialog();
  }

  policyIDdropdown(dc, allPolicies) {
    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');

    let policyList = [];
    for (let i = 0; i < allPolicies.length; i++) {
      policyList.push({
        title: `${allPolicies[i].insured} - ${allPolicies[i].carrier} - ${allPolicies[i].product}`,
        value: allPolicies[i].policyId.toString()
      });
    }

    dc.state.setValue('conversation.policyIdDisplayList', policyList);
    dc.state.setValue('conversation.policyIdLength', policyList.length);
    dc.state.setValue('conversation.policyNumber', policyLookupObj.policyNumber.toUpperCase());
    dc.state.setValue('dialog.promptForPolicyIdDropDown', true);
  }

  /**
   * Used to extract data from DC for generating API params
   * @param {*} dc
   * @returns
   */
  async extractParamsForAPI(dc) {
    const params = {
      authCode: dc.context.activity.channelData.authToken,
      apiBaseUrl: await getData(this.userState, dc.context, 'hostUrl')
    };

    const policyLookupObj = dc.state.getValue('conversation.policyLookupObj');
    if (policyLookupObj.policyNumber) {
      params.policyNumber = policyLookupObj.policyNumber;
    }
    if (policyLookupObj.policyId) {
      params.policyId = policyLookupObj.policyId;
    }

    return params;
  }

  /**
   * Update policyLookupObj with policyNumber, status
   * @param {object} dc
   * @param {alphnumeric} policyNumber
   * @param {string} status
   */
  updateContext(dc, policyNumber = null, status = null, policyId = null, reset = null) {
    const oldPolicyLookupObj = dc.state.getValue('conversation.policyLookupObj');
    const newPolicyLookupObj = reset ? {
      subFlow: oldPolicyLookupObj.subFlow,
      otherPolicyInfo: oldPolicyLookupObj.otherPolicyInfo,
      otherPolicyRestartText: oldPolicyLookupObj.otherPolicyRestartText
    } : dc.state.getValue('conversation.policyLookupObj');

    if (policyNumber) newPolicyLookupObj.policyNumber = policyNumber.toUpperCase();
    if (status) newPolicyLookupObj.status = status;
    if (policyId) newPolicyLookupObj.policyId = policyId;

    dc.state.setValue('conversation.policyLookupObj', newPolicyLookupObj);

    return newPolicyLookupObj;
  }

  async validatePolicyNumber(dc) {
    dc.state.setValue('conversation.repeat', true);
    dc.state.setValue('conversation.invalidPolicyNumber', true);
    dc.state.setValue('dialog.promptForPolicyIdDropDown', false);
    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');

    const policyNumber = policyLookupObj.policyNumber || dc.state.getValue('turn.policyNumber') || undefined;

    if (!(!!policyNumber)) {
      return dc.endDialog();
    }

    this.updateContext(dc, policyNumber);
    const params = await this.extractParamsForAPI(dc);
    const policyStatusDetails = await getPolicyLookupStatusAPI(params);

    if (!!policyStatusDetails.length) {
      dc.state.setValue('conversation.repeat', false);
      dc.state.setValue('conversation.invalidPolicyNumber', false);

      if (policyStatusDetails.length > 1) {
        this.policyIDdropdown(dc, policyStatusDetails);
      } else {
        this.updateContext(dc, null, null, policyStatusDetails[0].policyId);
      }
    }

    return dc.endDialog();
  }

  /**
   * Displays policy details adaptive card
   * @param {Object} dc 
   */
  async displayPolicyDetails(dc) {
    await this.redirectSubFlows(dc);

    return dc.endDialog();
  }

  /**
   * Function to redirect to specific subflow's adaptive card details
   * @param {Object} dc 
   */
  async redirectSubFlows(dc) {
    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');

    if (policyLookupObj.subFlow === 'policyCommission') {
      await this.displayPolicyCommissionDetails(dc);
      return;
    }

    if (policyLookupObj.subFlow === 'otherPolicyInfo') {
      await this.displayOtherPolicyDetails(dc);
      return;
    }
    await this.displayPolicyStatusDetails(dc);
  }

  /**
   * display policy status adaptive card
   * @param {Object} dc 
   */
  async displayPolicyStatusDetails(dc) {
    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');
    const params = await this.extractParamsForAPI(dc);
    const policyDetails = await getPolicyLookupStatusAPI(params);
    let message = `Details of ${policyLookupObj.policyNumber} for ${policyDetails[0].carrier}`;

    await dc.context.sendActivity(message);
    const policyData = await policyLookupStatusDetailsTable(policyDetails);
    await dc.context.sendActivity(policyData);
    dc.state.setValue('conversation.agentName', policyDetails[0].agent);
    await this.displayRestartFlowCard(dc);
  }

  /**
   * display policy commission adaptive card
   * @param {Object} dc 
   */
  async displayPolicyCommissionDetails(dc) {
    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');
    if (!!policyLookupObj.policyId) {
      const params = await this.extractParamsForAPI(dc);
      const policyStatusDetails = await getPolicyLookupStatusAPI(params);
      const policyCommissionDetails = await getPolicyCommissionDetailsAPI(params);
      const restartMessage = `Would you like to see the commission of another policy?`;
      const tableDescMsg = `Total commissions paid on policy ${policyLookupObj.policyNumber} of insured ${policyStatusDetails[0].insured}:`;

      const policyCommissionTable = await policyCommissionDetailsTable(policyCommissionDetails);

      await dc.context.sendActivity(tableDescMsg);

      await dc.context.sendActivity(policyCommissionTable);

      await this.displayRestartFlowCard(dc, restartMessage);
    }
  }

  /**
   * Display other policy details
   * @param {Object} dc 
   */
  async displayOtherPolicyDetails(dc) {
    let policyLookupObj = dc.state.getValue('conversation.policyLookupObj');
    const params = await this.extractParamsForAPI(dc);
    const policyDetails = await getPolicyLookupStatusAPI(params);
    let tempText = policyLookupObj.otherPolicyRestartText;
    tempText = tempText.charAt(0).toUpperCase() + tempText.slice(1);
    const restartMsg = `Would you like to see the ${policyLookupObj.otherPolicyRestartText} of another policy?`;

    if (policyLookupObj.otherPolicyInfo === 'issuedDate') {
      policyDetails[0].issuedDate = moment(policyDetails[0].issuedDate).format('MM/DD/YYYY');
    }

    const otherPolicyDetail = policyDetails[0][policyLookupObj.otherPolicyInfo];

    if (!otherPolicyDetail) {
      const errorMsg = `Sorry, there is no ${tempText} for policy ${policyLookupObj.policyNumber.toUpperCase()} of Insured ${policyDetails[0].insured}.`;
      await dc.context.sendActivity(errorMsg);
      await this.displayRestartFlowCard(dc, restartMsg);
      return;
    }

    let displayMsg = `${tempText} of Policy ${policyLookupObj.policyNumber.toUpperCase()} of Insured ${policyDetails[0].insured} is `;

    if (policyLookupObj.otherPolicyInfo === 'premium' || policyLookupObj.otherPolicyInfo === 'annualPremium') {
      displayMsg += `**$${(Number.parseFloat(otherPolicyDetail).toFixed(2)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}**.`;
    } else {
      displayMsg += `**${otherPolicyDetail}**.`;
    }

    await dc.context.sendActivity(displayMsg);

    await this.displayRestartFlowCard(dc, restartMsg);
  }

  /**
   * Handles restart prompt
   * @param {Object} dc 
   * @returns 
   */
  async handleNeedRestartPrompt(dc) {
    if (!dc.state.getValue('dialog.promptForRestart')) {
      return dc.endDialog();
    }

    const params = await this.extractParamsForAPI(dc);
    const policyDetails = await getPolicyLookupStatusAPI(params);

    dc.state.setValue('dialog.promptForRestart', false);
    const status = dc.state.getValue('turn.needRestart').toLowerCase();
    if (status === 'no, thanks') { // No is clicked
      dc.state.setValue('conversation.displayAgent', {
        agentId: policyDetails[0].agentID,
        name: policyDetails[0].agent
      });
      await dc.context.sendActivity({
        type: 'event',
        name: 'displayAgent',
        value: {
          agentId: policyDetails[0].agentID,
          agentName: policyDetails[0].agent
        }
      });
      const message = `Additional information on agent **${policyDetails[0].agent}**.`;
      await dc.context.sendActivity(message);
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
   * This method is used to display Restart flow (Other carriers) card
   * @param {*} dc
   * @param {*} message
   */
  async displayRestartFlowCard(dc, message = null) {
    message = message || `Would you like to see the status of another policy?`;

    await dc.context.sendActivity(message);
    dc.state.setValue('dialog.promptForRestart', true);
  }


}

module.exports.PolicyLookupDialog = PolicyLookupDialog;