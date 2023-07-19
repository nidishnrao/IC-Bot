const { ComponentDialog } = require("botbuilder-dialogs");
const { CardFactory, MessageFactory } = require('botbuilder');
const { Templates } = require("botbuilder-lg");
const {
  AdaptiveDialog,
  LuisAdaptiveRecognizer,
  TemplateEngineLanguageGenerator,
  OnBeginDialog,
  CodeAction,
  IfCondition,
  SendActivity
} = require('botbuilder-dialogs-adaptive');
const path = require("path");
const { StringExpression, BoolExpression } = require('adaptive-expressions');
const moment = require('moment');

const { getData } = require('../../core/accessors/sessionManagement');
const { getProfileInformationAPI } = require('./profileInformationDialogAPIs');

const DIALOG_ID = 'PROFILE_INFORMATION_DIALOG';

class ProfileInformationDialog extends ComponentDialog {
  userState;
  lgFile;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'profileInformationDialog.lg'));

    // Main profile information Dialog
    const profileInformationDialog = new AdaptiveDialog(DIALOG_ID).configure({
      generator: new TemplateEngineLanguageGenerator(this.lgFile),
      recognizer: this.createLuisRecognizer(),

      triggers: [
        new OnBeginDialog([
          new CodeAction(this.handleInit.bind(this)),

          // End the contract flows and start other flows
          new IfCondition().configure({
            condition: new BoolExpression('dialog.endFlow'),
            actions: [
              new SendActivity('${InitiateOtherFlowText()}')
            ]
          })
        ])
      ]
    });

    this.addDialog(profileInformationDialog);
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
    await this.getProfileInfoDetails(dc);
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
   * Used to extract data from DC for generating API params
   * @param {*} dc
   * @returns
   */
  async extractParamsForAPI(dc) {
    const params = {
      authCode: dc.context.activity.channelData.authToken,
      apiBaseUrl: await getData(this.userState, dc.context, 'hostUrl'),
      agentId: dc.state.getValue('conversation.displayAgent').agentId
    };

    return params;
  }

  async getProfileInfoDetails(dc) {
    const profileInfoObj = dc.state.getValue('conversation.profileInfoObj');
    const agentName = dc.state.getValue('conversation').displayAgent.name;
    const params = await this.extractParamsForAPI(dc);
    const profileInfoDetails = await getProfileInformationAPI(params);
    let data;

    switch (profileInfoObj.profileInfoType) {
      case 'marketers' :
        if (profileInfoDetails.marketers?.length) {
          const marketers = profileInfoDetails.marketers;
          let bulletList = '';
          const message = `${agentName} is associated with the following marketers`;

          marketers.forEach((val, i) => bulletList += `\r- ${val.name}`);
          
          data = `${message}\n${bulletList}`;
        } else {
          data = `No data found`;
        }
        break;
      case 'agent groups' :
        if (profileInfoDetails.agentGroups?.length) {
          const agentGroups = profileInfoDetails.agentGroups;
          let bulletList = '';
          const message = `${agentName} is a part of the following groups`;
          
          agentGroups.forEach(val => bulletList += `\r- ${val.groupName}`);
          
          data = `${message}\n${bulletList}`;
        } else {
          data = `No data found`;
        }
        break;
      case 'dob' :
        if (profileInfoDetails.dob?.trim()) {
          const dob = moment(profileInfoDetails.dob.trim()).format('MM/DD/YYYY');
          const age = moment().diff(dob, 'years');
          data = `${ agentName }'s ${ profileInfoObj.profileInfoType.toUpperCase() } is **${ dob } (${ age })**.`;
        } else {
          data = `No data found`;
        }
        break;
      case 'ssn' :
        if (profileInfoDetails.ssn?.trim()) {
          let ssn = profileInfoDetails.ssn.trim();
          ssn = 'xxx-xx-'.concat('',ssn.slice(5));
          data = `${ agentName }'s SSN is **${ ssn }**.`;
        } else {
          data = `No data found`;
        }
        break;
      case 'dba' :
      case 'npn' :
      case 'tin' :
        if (profileInfoDetails[profileInfoObj.profileInfoType]?.trim()) {
          data = `${ agentName }'s ${ profileInfoObj.profileInfoType.toUpperCase() } is **${ profileInfoDetails[profileInfoObj.profileInfoType].trim() }**.`;
        } else {
          data = `No data found`;
        }
        break;
      default :
        data = `Intent not recognized`;
        break;
    }

    await dc.context.sendActivity(data);
    this.endFlow(dc);
  }

}

module.exports.ProfileInformationDialog = ProfileInformationDialog;