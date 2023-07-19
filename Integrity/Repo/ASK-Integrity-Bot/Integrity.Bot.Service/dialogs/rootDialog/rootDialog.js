/* eslint-disable no-template-curly-in-string */
const path = require('path');
const { ComponentDialog } = require('botbuilder-dialogs');
const {
  AdaptiveDialog,
  LuisAdaptiveRecognizer,
  OnIntent,
  OnUnknownIntent,
  SendActivity,
  TemplateEngineLanguageGenerator,
  BeginDialog,
  CodeAction,
  CancelAllDialogs
} = require('botbuilder-dialogs-adaptive');
const { StringExpression } = require('adaptive-expressions');
const { Templates } = require('botbuilder-lg');

const { AgentDialog } = require('../agentDialog/agentDialog');
const { CommissionDialog } = require('../commissionDialog/commissionDialog');
const { ContractDialog } = require('../contractDialog/contractDialog');
const { HierarchyDialog } = require('../hierarchyDialog/hierarchyDialog');
const { ProductCertificationDialog } = require('../certificationDialog/productCertificationDialog');
const { CarrierCertificationDialog } = require('../certificationDialog/carrierCertificationDialog');
const { AddressDialog } = require('../addressDialog/addressDialog');
const { ContactInformationDialog } = require('../contactInformationDialog/contactInformationDialog');
const { ProfileInformationDialog } = require('../profileInformationDialog/profileInformationDialog');
const { PolicyLookupDialog } = require('../policyLookupDialog/policyLookupDialog');
const { AgentGeolocationDialog } = require('../agentGeolocationDialog/agentGeolocationDialog');

const {
  getAdaptiveCardButtons,
  getTipCard
} = require('../../core/commons/utils');

const ROOT_DIALOG = 'ROOT_DIALOG';

/**
 * This is the entry point dialog.
 */
class RootDialog extends ComponentDialog {
  userState;

  constructor(userState) {
    super(ROOT_DIALOG);

    this.userState = userState;
    const lgFile = Templates.parseFile(path.join(__dirname, 'rootDialog.lg'));

    const rootDialog = new AdaptiveDialog(ROOT_DIALOG).configure({
      generator: new TemplateEngineLanguageGenerator(lgFile),
      recognizer: this.createLuisRecognizer(),

      // Goto to a dialog, If LUIS identifies any intent
      triggers: [
        new OnIntent(
          'Agent',
          [],
          [new BeginDialog('AGENT_DIALOG')],
          '#Agent.Score >= 0.7'
        ),

        new OnIntent(
          'Other',
          [],
          [new BeginDialog('AGENT_DIALOG')],
          '#Other.Score >= 0.8'
        ),

        new OnIntent(
          'ChangeAgent',
          [],
          [
            new CodeAction(this.removeAgent.bind(this)),
            new BeginDialog('AGENT_DIALOG'),
            new CancelAllDialogs()
          ],
          '#ChangeAgent.Score >= 0.8'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'Commission',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getCommissionDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#Commission.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@personName != null) || (@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'Commission',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getCommissionDetailsFromLUIS.bind(this)),
            new BeginDialog('COMMISSION_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#Commission.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'Contract',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getContractDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#Contract.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@personName != null) || (@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'Contract',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getContractDetailsFromLUIS.bind(this)),
            new BeginDialog('CONTRACT_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#Contract.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Other Intents
        new OnIntent(
          'Help',
          [],
          // eslint-disable-next-line no-template-curly-in-string
          [new SendActivity('${Help()}')],
          '#Help.Score >= 0.8'
        ),

        new OnIntent(
          'Appointments',
          [],
          [new SendActivity('${FlowNotDeveloped()}')],
          '#Appointments.Score >= 0.8'
        ),

        new OnIntent(
          'ApplicationStatus',
          [],
          [new SendActivity('${FlowNotDeveloped()}')],
          '#ApplicationStatus.Score >= 0.8'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'Hierarchy',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getHierarchyDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#Hierarchy.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@personName == null) || (@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'Hierarchy',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getHierarchyDetailsFromLUIS.bind(this)),
            new BeginDialog('HIERARCHY_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#Hierarchy.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'ProductCertification',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getProductCertificationDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#ProductCertification.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'ProductCertification',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getProductCertificationDetailsFromLUIS.bind(this)),
            new BeginDialog('PRODUCT_CERTIFICATION_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#ProductCertification.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'CarrierCertification',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getCarrierCertificationsDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#CarrierCertification.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'CarrierCertification',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getCarrierCertificationsDetailsFromLUIS.bind(this)),
            new BeginDialog('CARRIER_CERTIFICATION_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#CarrierCertification.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'Address',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getAddressDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#Address.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@personName != null) || (@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'Address',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getAddressDetailsFromLUIS.bind(this)),
            new BeginDialog('ADDRESS_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#Address.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'ContactInformation',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getContactInformationDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#ContactInformation.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@personName != null) || (@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'ContactInformation',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getContactInformationDetailsFromLUIS.bind(this)),
            new BeginDialog('CONTACT_INFORMATION_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#ContactInformation.Score >= 0.7) && (conversation.displayAgent != null)'
        ),

        // Agent is not set or LUIS return agent details
        new OnIntent(
          'ProfileInformation',
          [],
          [
            new CodeAction(this.setFlow.bind(this)),
            new CodeAction(this.getProfileInformationDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_DIALOG')
          ],
          '(#ProfileInformation.Score >= 0.7) && (!conversation.displayAgent || ((conversation.displayAgent != null) && ((@personName != null) || (@agentName != null) || (@number != null))))'
        ),

        // Agent is set and LUIS did not return any agent details
        new OnIntent(
          'ProfileInformation',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getProfileInformationDetailsFromLUIS.bind(this)),
            new BeginDialog('PROFILE_INFORMATION_DIALOG'),
            new CancelAllDialogs()
          ],
          '(#ProfileInformation.Score >= 0.7) && (conversation.displayAgent != null)'
        ),
        new OnIntent(
          'PolicyLookup',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getPolicyLookupDetailsFromLUIS.bind(this)),
            new BeginDialog('POLICY_LOOKUP_DIALOG'),
            new CancelAllDialogs()
          ],
          '#PolicyLookup.Score >= 0.7'
        ),

        new OnIntent(
          'AgentGeolocation',
          [],
          [
            new CodeAction(this.clearFlow.bind(this)),
            new CodeAction(this.getAgentGeolocationDetailsFromLUIS.bind(this)),
            new BeginDialog('AGENT_GEOLOCATION_DIALOG'),
            new CancelAllDialogs()
          ],
          '#AgentGeolocation.Score >= 0.7'
        ),

        new OnIntent(
          'Reminders',
          [],
          [new SendActivity('${FlowNotDeveloped()}')],
          '#Reminders.Score >= 0.8'
        ),

        new OnIntent(
          'ServiceTickets',
          [],
          [new SendActivity('${FlowNotDeveloped()}')],
          '#ServiceTickets.Score >= 0.8'
        ),

        // Start Over
        new OnIntent(
          'StartOver',
          [],
          [
            new CodeAction(this.removeAgent.bind(this)),
            new CodeAction(this.clearFlow.bind(this)),
            new SendActivity('${StartOverMessage()}'),
            new CodeAction(this.sendOptions.bind(this)),
            new CancelAllDialogs()
          ],
          '#StartOver.Score >= 0.8'
        ),

        // Error handling
        new OnUnknownIntent([new SendActivity('${UnknownIntent()}')])
      ]
    });

    // Add all dialogs
    this.addDialog(rootDialog);
    this.addDialog(new AgentDialog(userState));
    this.addDialog(new CommissionDialog(userState));
    this.addDialog(new ContractDialog(userState));
    this.addDialog(new HierarchyDialog(userState));
    this.addDialog(new ProductCertificationDialog(userState));
    this.addDialog(new CarrierCertificationDialog(userState));
    this.addDialog(new AddressDialog(userState));
    this.addDialog(new ContactInformationDialog(userState));
    this.addDialog(new ProfileInformationDialog(userState));
    this.addDialog(new PolicyLookupDialog(userState));
    this.addDialog(new AgentGeolocationDialog(userState));
    this.initialDialogId = ROOT_DIALOG;
  }

  /**
   * Creates LUIS Recognizer
   * @returns
   */
  createLuisRecognizer() {
    if (
      process.env.LuisAppId === '' ||
      process.env.LuisAPIHostName === '' ||
      process.env.LuisAPIKey === ''
      // eslint-disable-next-line no-throw-literal
    ) { throw 'Sorry, you need to configure your LUIS application and update .env file.'; }
    return new LuisAdaptiveRecognizer().configure({
      endpoint: new StringExpression(process.env.LuisAPIHostName),
      endpointKey: new StringExpression(process.env.LuisAPIKey),
      applicationId: new StringExpression(process.env.LuisAppId)
    });
  }

  /**
   * Removes agent object from session
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async removeAgent(dc, options) {
    dc.state.setValue('conversation.displayAgent', null);
    dc.state.setValue('conversation.agentObj', null);
    dc.state.setValue('conversation.commissionObj', null);
    await dc.context.sendActivity({ type: 'event', name: 'hideAgent' });
    return dc.endDialog();
  }

  /**
   * Extract commission related entities from LUIS
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async getCommissionDetailsFromLUIS(dc, options) {
    await this.clearObjects(dc);
    const commissionObj = {};
    const entities = dc.state.getValue('turn').recognized.entities;
    commissionObj.carrierName = entities.carrier ? entities.carrier[0][0] : null;
    commissionObj.productType = entities.$instance.product ? entities.$instance.product[0].text : null;
    dc.state.setValue('conversation.commissionObj', commissionObj);
    console.log('commissionObj: ', commissionObj);
    return dc.endDialog();
  }

  /**
   * Extract contract related entities from LUIS
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async getContractDetailsFromLUIS(dc, options) {
    await this.clearObjects(dc);
    const contractObj = {};
    const entities = dc.state.getValue('turn').recognized.entities;
    contractObj.carrierName = entities.carrier ? entities.carrier[0][0] : null;
    // contractObj.productType = entities.$instance.product ? entities.$instance.product[0].text : null;
    contractObj.productType = entities.product ? entities.product[0][0] : null;
    /*contractObj.subFlow = entities.$instance.awn ? 'awn' : (entities.$instance.payout ? 'payout' : null);*/
    contractObj.subFlow = entities.$instance.awn ? 'awn' : entities.$instance.payout ? 'payout' : (entities.$instance.status ? 'status' : null);
    dc.state.setValue('conversation.contractObj', contractObj);
    console.log('contractObj: ', contractObj);
    return dc.endDialog();
  }

  /**
   * Extract hierarchy related entities from LUIS
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async getHierarchyDetailsFromLUIS(dc, options) {
    await this.clearObjects(dc);
    const hierarchyObj = {};
    const entities = dc.state.getValue('turn').recognized.entities;
    hierarchyObj.carrierName = entities.carrier ? entities.carrier[0] : null;
    hierarchyObj.subFlow = null;
    if (entities.$instance.toh) {
      hierarchyObj.subFlow = 'toh';
    }
    if (entities.$instance.ImmediateUpline) {
      hierarchyObj.subFlow = 'ImmediateUpline';
    }
    if (entities.$instance.downlineCount) {
      hierarchyObj.subFlow = 'downlineCount';
    }
    dc.state.setValue('conversation.hierarchyObj', hierarchyObj);
    console.log('hierarchyObj: ', hierarchyObj);
    return dc.endDialog();
  }

  async getProductCertificationDetailsFromLUIS(dc) {
    await this.clearObjects(dc)
    const productCertificationObj = {}
    const entities = dc.state.getValue('turn').recognized.entities
    productCertificationObj.carrierName = entities.carrier ? entities.carrier[0][0] : null
    productCertificationObj.certificationYear = entities.datetime ? entities.datetime[0].timex[0] : new Date().getFullYear()
    productCertificationObj.productType = entities.product ? entities.product[0][0] : null

    dc.state.setValue('conversation.productCertificationObj', productCertificationObj)
    return dc.endDialog()
  }

  async getCarrierCertificationsDetailsFromLUIS(dc) {
    await this.clearObjects(dc);
    const carrierCertificationObj = {}
    const entities = dc.state.getValue('turn').recognized.entities
    carrierCertificationObj.certificationYear = entities.datetime ? entities.datetime[0].timex[0] : new Date().getFullYear()
    carrierCertificationObj.productType = entities.product ? entities.product[0][0] : null

    dc.state.setValue('conversation.carrierCertificationObj', carrierCertificationObj)
    return dc.endDialog()
  }

  async getAddressDetailsFromLUIS(dc) {
    await this.clearObjects(dc);
    const addressObj = {};
    const entities = dc.state.getValue('turn').recognized.entities;
    addressObj.addressType = entities.addressType ? entities.addressType[0][0] : null;

    dc.state.setValue('conversation.addressObj', addressObj);
    return dc.endDialog();
  }

  async getContactInformationDetailsFromLUIS(dc) {
    await this.clearObjects(dc);
    const contactInfoObj = {};
    const entities = dc.state.getValue('turn').recognized.entities;
    contactInfoObj.contactType = entities.contactOptionType ? entities.contactOptionType[0][0] : null;

    dc.state.setValue('conversation.contactInfoObj', contactInfoObj);
    return dc.endDialog();
  }

  async getProfileInformationDetailsFromLUIS(dc) {
    await this.clearObjects(dc);
    const profileInfoObj = {};
    const entities = dc.state.getValue('turn').recognized.entities;
    profileInfoObj.profileInfoType = entities.profileInfoType ? entities.profileInfoType[0][0] : null;

    dc.state.setValue('conversation.profileInfoObj', profileInfoObj);
    return dc.endDialog();
  }
  
  async getPolicyLookupDetailsFromLUIS(dc) {
    await this.clearObjects(dc);
    const policyLookupObj = {};
    const entities = dc.state.getValue('turn').recognized.entities
    
    policyLookupObj.subFlow = null;
    policyLookupObj.status = entities.policyStatus ? entities.policyStatus[0][0] : null;
    policyLookupObj.policyNumber = entities.policyNumber ? entities.policyNumber[0].toUpperCase() : null;
    
    if (!!entities.$instance?.policyCommission?.length) {
      policyLookupObj.subFlow = 'policyCommission';
    }

    if (!!entities.$instance?.otherPolicyInfo?.length) {
      policyLookupObj.subFlow = 'otherPolicyInfo';
      policyLookupObj.otherPolicyInfo = entities.otherPolicyInfo[0][0];
      policyLookupObj.otherPolicyRestartText = entities.$instance.otherPolicyInfo[0].text;
    }

    dc.state.setValue('conversation.policyLookupObj', policyLookupObj);
    return dc.endDialog();
  }
  
  async getAgentGeolocationDetailsFromLUIS(dc) {
    await this.clearObjects(dc);

    const agentGeolocationObj = {};
    let zip = null;
    const entities = dc.state.getValue('turn').recognized.entities;

    agentGeolocationObj.distance = entities.dimension ? entities.dimension[0].number : null;
    agentGeolocationObj.carrierName = entities.carrier ? entities.carrier[0][0] : null;

    let recognizedNumbers = entities.number ? entities.number : null;

    if (recognizedNumbers) {
      recognizedNumbers.forEach(val => {
        if (val.toString().length === 5) {
          zip = val;
        }
      });
    }
    agentGeolocationObj.zipCode = zip;

    dc.state.setValue('conversation.agentGeolocationObj', agentGeolocationObj);
    return dc.endDialog();
  }

  /**
   * Clear commission and contract objects from session
   * @param {*} dc
   */
  async clearObjects(dc) {
    let commissionObj = dc.state.getValue('conversation.commissionObj');
    if (commissionObj) {
      commissionObj = {};
    }
    dc.state.setValue('conversation.commissionObj', commissionObj);

    let contractnObj = dc.state.getValue('conversation.contractnObj');
    if (contractnObj) {
      contractnObj = {};
    }
    dc.state.setValue('conversation.contractnObj', contractnObj);
  }

  /**
   * Set current flow in session
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async setFlow(dc, options) {
    var data = dc.state.getValue('turn');
    dc.state.setValue('conversation.currentFlow', data.recognized.intent);
    return dc.endDialog();
  }

  /**
   * Clear current flow in session
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async clearFlow(dc, options) {
    dc.state.setValue('conversation.currentFlow', null);
    return dc.endDialog();
  }

  /**
   * Send initial menu
   * @param {*} dc
   * @param {*} options
   * @returns
   */
  async sendOptions(dc, options) {
    const welcomeOptions = ['Agent Info', 'Reminders', 'Service Tickets'];
    const welcomeOptionButtons = await getAdaptiveCardButtons(welcomeOptions);
    const tipMessage = 'You can also type a question to get started.';
    const tipCard = await getTipCard(tipMessage);

    await dc.context.sendActivities([
      { type: 'typing' },
      {
        type: 'message',
        text: 'Most of the users need help with one of the following topics.'
      },
      tipCard,
      welcomeOptionButtons
    ]);
    return dc.endDialog();
  }
}

module.exports.RootDialog = RootDialog;
