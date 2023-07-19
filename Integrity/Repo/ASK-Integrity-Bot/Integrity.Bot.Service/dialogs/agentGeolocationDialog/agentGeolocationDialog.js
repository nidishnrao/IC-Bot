const path = require('path');
const { ComponentDialog } = require('botbuilder-dialogs');
const fs = require('fs');
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
  RepeatDialog,
  OnIntent,
  ContinueLoop
} = require('botbuilder-dialogs-adaptive');
const { StringExpression, ValueExpression, BoolExpression, Expression } = require('adaptive-expressions');
const { Templates } = require('botbuilder-lg');
const { ActivityHandler, ActionTypes, ActivityTypes, CardFactory } = require('botbuilder');

const { getData } = require('../../core/accessors/sessionManagement');
const { getCarriersForAgentAPI, getAgentsByGeoLocationAPI } = require('./agentGeoLocationAPIs');

const {
  searchAgentsByGeolocationTable,
  sendTypingIndicator
} = require('../../core/commons/utils');

const DIALOG_ID = 'AGENT_GEOLOCATION_DIALOG';

class AgentGeolocationDialog extends ComponentDialog {
  userState;
  lgFile;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'agentGeolocationDialog.lg'));

    // Custom function for interrupt
    Expression.functions.add('checkForInterrupt', args => {
      if ((args[0].Help && args[0].Help.score >= 0.8) ||
        (args[0].StartOver && args[0].StartOver.score >= 0.8) ||
        (args[0].downloadResults && args[0].downloadResults.score >= 0.8)) {
        return true;
      }

      return false;
    });

    const agentGeoLoc = new AdaptiveDialog(DIALOG_ID).configure({
      generator: new TemplateEngineLanguageGenerator(this.lgFile),
      recognizer: this.createLuisRecognizer(),
      triggers: [
        new OnBeginDialog([
          new CodeAction(this.handleInit.bind(this)),

          // when zip code is not given or when zip code is invalid in the utterance
          new TextInput().configure({
            property: new StringExpression('turn.ValidateZipCode'),
            prompt: new ActivityTemplate('${ZipCodePrompt()}'),
            validations: ['(turn.recognized.entities.number != null) && (count(this.value) == 5)'],
            invalidPrompt: new ActivityTemplate('${InvalidZipCodePrompt()}'),
            allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)'),
            disabled: new BoolExpression('!dialog.promptForZipCode')
          }),

          new CodeAction(this.handleZipCode.bind(this)),

          // when carrier name is not given in the utterance
          new TextInput().configure(
            {
              property: new StringExpression('turn.carrierName'),
              prompt: new ActivityTemplate('${AskCarrierNamePrompt()}'),
              validations: ['(turn.recognized.entities.carrier[0][0] != null)'],
              invalidPrompt: new ActivityTemplate('${AskInvalidCarrierDropdownPrompt()}'),
              allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents, turn.recognized.text)'), // new BoolExpression("false"),
              disabled: new BoolExpression('!dialog.promptForCarrier')
            }
          ),

          new CodeAction(this.handleCarrier.bind(this)),

          // Restart prompt
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

          new CodeAction(this.handleRestartPrompt.bind(this)),

          // End of Geolocation search flow, start other flow
          new IfCondition().configure({
            condition: new BoolExpression('dialog.endFlow'),
            actions: [
              new SendActivity('${InitiateOtherFlowText()}'),
              new EndDialog()
            ]
          }),

          // Restart Geolocation search flow
          new IfCondition().configure({
            condition: new BoolExpression('turn.restartFlow'),
            actions: [
              new RepeatDialog()
            ]
          })
        ])
      ]
    });

    this.addDialog(agentGeoLoc);
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
   * Initial function
   * @param {*} dc
   * @return
   */
  async handleInit(dc) {
    await dc.context.sendActivity({ type: 'event', name: 'hideAgent' });
    let agentGeoLocObj = dc.state.getValue('conversation.agentGeolocationObj');
    let zip = undefined;

    if (dc.state.getValue('turn.restartFlow')) {
      agentGeoLocObj = this.updateContext(dc, null, null, null, true);
    }

    if (!agentGeoLocObj.zipCode) {
      dc.state.setValue('dialog.promptForZipCode', true);
      return dc.endDialog();
    } else {
      if (!!agentGeoLocObj.carrierName) {
        await this.searchAgent(dc);
      } else {
        await this.carrierDropDown(dc);
      }
    }

    return dc.endDialog();
  }

  /**
   * @param {*} dc
   * @return
   */
  async handleZipCode(dc) {
    if (!dc.state.getValue('dialog.promptForZipCode')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.promptForZipCode', false);

    const userResponse = dc.state.getValue('turn.ValidateZipCode');

    this.updateContext(dc, null, null, userResponse);

    let agentGeoLocObj = dc.state.getValue('conversation.agentGeolocationObj');

    if (!agentGeoLocObj.carrierName) {
      await this.carrierDropDown(dc);
    } else {
      await this.searchAgent(dc);
    }

    return dc.endDialog();
  }

  /**
   * Handle Carrier selection from dropdown
   * @param {*} dc
   * @return
   */
  async handleCarrier(dc) {
    if (!dc.state.getValue('dialog.promptForCarrier')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.promptForCarrier', false);

    const userResponse = dc.state.getValue('turn.carrierName');

    this.updateContext(dc, null, userResponse);

    await this.searchAgent(dc);

    return dc.endDialog();
  }

  /**
   * search agent
   */
  async searchAgent(dc) {
    let agentGeoLocObj = dc.state.getValue('conversation.agentGeolocationObj');

    const agentsFound = await this.getAgentsByGeoLocation(dc);

    dc.state.setValue('turn.agentsFound', agentsFound.length);
    dc.state.setValue('turn.carrierName', agentGeoLocObj.carrierName);

    if (!!agentsFound.length) {
      const agentsDisplayed = [];
      agentsFound.forEach((value, index) => {
        if (index <= 14) {
          agentsDisplayed.push({
            agentId: value.agentId.toString(),
            agentName: value.agentName,
            city: value.city,
            state: value.state
          });
        }
      });
      await dc.context.sendActivity(`Showing 1-${agentsFound.length > 15 ? 15 : agentsFound.length} of ${agentsFound.length} results of ${agentGeoLocObj.carrierName} agents in ZIP ${agentGeoLocObj.zipCode}.`)
      const adaptiveCardData = await searchAgentsByGeolocationTable(agentsDisplayed, agentGeoLocObj);
      await dc.context.sendActivity(adaptiveCardData);
    }


    dc.state.setValue('dialog.promptForRestart', true);
  }

  /**
   * handler for restart flow
   */
  async handleRestartPrompt(dc) {
    if (!dc.state.getValue('dialog.promptForRestart')) {
      return dc.endDialog();
    }

    dc.state.setValue('dialog.promptForRestart', false);

    const userResponse = dc.state.getValue('turn.needRestart');

    if (userResponse === 'No, thanks') {
      await dc.context.sendActivity(this.lgFile.evaluate('NoThanksText', dc.context.activity));
      dc.state.setValue('dialog.endFlow', true);
      return dc.endDialog();
    }

    dc.state.setValue('turn.restartFlow', true);
    return dc.endDialog();
  }

  /**
   * update geolocation object
   * @param {*} dc
   * @param {*} distance
   * @param {*} carrierName
   * @param {*} zipCode
   * @param {*} reset
   * @return
   */
  updateContext(dc, distance = null, carrierName = null, zipCode = null, reset = null) {
    const agentGeoLocObj = dc.state.getValue('conversation.agentGeolocationObj');

    if (reset) {
      delete agentGeoLocObj.carrierName;
      return agentGeoLocObj;
    }

    if (distance) agentGeoLocObj.distance = distance;
    if (carrierName) agentGeoLocObj.carrierName = carrierName;
    if (zipCode) agentGeoLocObj.zipCode = zipCode;

    dc.state.setValue('conversation.agentGeolocationObj', agentGeoLocObj);
    return agentGeoLocObj;
  }

  /**
   * Used to extract data from DC for generating API params
   * @param {*} dc
   * @returns
   */
  async exactParamsForAPI(dc) {
    const params = {
      authCode: dc.context.activity.channelData.authToken,
      apiBaseUrl: await getData(this.userState, dc.context, 'hostUrl')
    };

    const agentGeolocationObj = dc.state.getValue('conversation.agentGeolocationObj');

    if (agentGeolocationObj.zipCode) {
      params.zipCode = agentGeolocationObj.zipCode
    }

    if (agentGeolocationObj.carrierName) {
      params.carrierName = agentGeolocationObj.carrierName
    }

    if (agentGeolocationObj.distance) {
      params.distance = agentGeolocationObj.distance
    }

    return params;
  }

  /**
   * Error handling for API calls
   */
  async checkForError(dc, response) {
    if (typeof response === 'string' && ((response.toLowerCase().includes('doctype html')) || response.includes('Unauthorized') || response.includes('Error'))) {
      await dc.context.sendActivity(this.lgFile.evaluate('APIErrorText', dc.context.activity));
      return true;
    }
    return false;
  }

  /**
   * Get all carriers API call
   */
  async getAllCarriers(dc) {
    const params = await this.exactParamsForAPI(dc);
    const carriers = await getCarriersForAgentAPI(params);
    await sendTypingIndicator(dc.context);

    if (await this.checkForError(dc, carriers)) {
      return dc.endDialog();
    }

    return carriers;
  }

  /**
   * 
   */
  async getAgentsByGeoLocation(dc) {
    const params = await this.exactParamsForAPI(dc);
    const agentsFound = await getAgentsByGeoLocationAPI(params);
    await sendTypingIndicator(dc.context);

    if (await this.checkForError(dc, agentsFound)) {
      return dc.endDialog();
    }

    return agentsFound;
  }

  /**
   * Display Carrier dropdown
   * @param {*} dc
   * @return
   */
  async carrierDropDown(dc) {
    let agentGeoLocObj = dc.state.getValue('conversation.agentGeolocationObj');
    const allCarriers = await this.getAllCarriers(dc);
    const carriersList = [];
    const message = `Sure, I have found agents in the ZIP ${agentGeoLocObj.zipCode}`

    allCarriers.forEach(item => {
      carriersList.push({
        title: item.carrierName,
        value: item.carrierName
      });
    });

    dc.state.setValue('turn.showCarrierDdMessage', message);
    dc.state.setValue('conversation.carrierdisplayList', carriersList);
    dc.state.setValue('dialog.promptForCarrier', true);
  }



}

module.exports.AgentGeolocationDialog = AgentGeolocationDialog;