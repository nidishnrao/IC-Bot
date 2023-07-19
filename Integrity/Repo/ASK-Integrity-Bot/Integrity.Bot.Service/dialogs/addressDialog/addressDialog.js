const { ComponentDialog } = require("botbuilder-dialogs");
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

const { getData } = require('../../core/accessors/sessionManagement');
const { getAddressAPI } = require('./addressDialogAPIs');
const { addressDetailsTable } = require('../../core/commons/utils');

const DIALOG_ID = 'ADDRESS_DIALOG';

class AddressDialog extends ComponentDialog {
  userState;
  lgFile;

  constructor(userState) {
    super(DIALOG_ID);

    this.userState = userState;
    this.lgFile = Templates.parseFile(path.join(__dirname, 'addressDialog.lg'));

    // Main Address Dialog
    const addressDialog = new AdaptiveDialog(DIALOG_ID).configure({
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

    this.addDialog(addressDialog);
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
    await this.getAddressDetails(dc);
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

    const addressObj = dc.state.getValue('conversation.addressObj');

    if (addressObj.addressType) {
      params.addressType = addressObj.addressType;
    }

    return params;
  }

  async getAddressDetails(dc) {
    const params = await this.extractParamsForAPI(dc);
    const addressDetails = await getAddressAPI(params);
    let data;

    if (addressDetails.data.length) {
      if (addressDetails.data.length > 10) {
        const result = addressDetails.data.filter(
          val => (val.isCommission === true || 
                  val.isDefault === true || 
                  val.isHome === true));
        
        data = await addressDetailsTable(result);
      } else {
        data = await addressDetailsTable(addressDetails.data);
      }
    } else {
      data = `No Details found`;
    }
    
    await dc.context.sendActivity(data);

    this.endFlow(dc);
  }

}

module.exports.AddressDialog = AddressDialog;