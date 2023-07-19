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
const { StringExpression, BoolExpression, Expression } = require('adaptive-expressions');
const { Templates } = require('botbuilder-lg');

const { getData } = require('../../core/accessors/sessionManagement');
const { getCommissionCards, commissionDetailsTable, getAxiosReq, sendTypingIndicator } = require('../../core/commons/utils');
const { API_VERSION, UP_ICON, DOWN_ICON, NO_CHANGE_ICON } = require('../../core/commons/config');

const DIALOG_ID = 'COMMISSION_DIALOG';

/**
 * Used to get commission for the agent
 */
class CommissionDialog extends ComponentDialog {
    userState;
    lgFile;

    constructor(userState) {
        super(DIALOG_ID);

        this.userState = userState;
        this.lgFile = Templates.parseFile(path.join(__dirname, 'commissionDialog.lg'));

        // Custom function to detect interrupts
        Expression.functions.add('checkForCommissionDialogInterrupt', (args) => {
            console.log('\nturn.recognized: ', args[0]);
            const allowInterrupts = ['Help', 'StartOver', 'ChangeAgent', 'Contract'];
            for (let i = 0; i < allowInterrupts.length; i++) {
                if (args[0][allowInterrupts[i]] && args[0][allowInterrupts[i]].score >= 0.8) {
                    return true;
                }
            }
            return false;
        });

        // Commission Dialog
        const commissionDialog = new AdaptiveDialog(DIALOG_ID).configure({
            generator: new TemplateEngineLanguageGenerator(this.lgFile),
            recognizer: this.createLuisRecognizer(),

            triggers: [
                new OnBeginDialog([
                    new CodeAction(this.handleInitialCommissionFlow.bind(this)),

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
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'), // new BoolExpression("false"),
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
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'), // new BoolExpression("false"),
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
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'),
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
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!dialog.similarCarrierPrompt')
                        }
                    ),
                    new CodeAction(this.validateSimilarCarrier.bind(this)),

                    // Ask for product type again if given at start is wrong
                    new TextInput().configure(
                        {
                            property: new StringExpression('turn.productType'),
                            prompt: new ActivityTemplate('${ProductRepromptDropdownText()}'),
                            validations: ['(turn.recognized.entities.product[0][0] != null)'],
                            invalidPrompt: new ActivityTemplate('${ProductRepromptDropdownText()}'),
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!dialog.checkForProductType')
                        }
                    ),
                    new CodeAction(this.checkIfValidProductType.bind(this)),

                    // Ask for product type confirm prompt
                    new TextInput().configure(
                        {
                            property: new StringExpression('turn.showProductType'),
                            prompt: new ActivityTemplate('${AskProductTypeConfirmPrompt()}'),
                            validations: ['(turn.recognized.entities.commissionByProduct != null)'],
                            invalidPrompt: new ActivityTemplate('${AskProductTypeConfirmPrompt()}'),
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!dialog.proptForProductType')
                        }
                    ),
                    new CodeAction(this.checkToProceedForProductType.bind(this)),

                    // Ask for product type prompt
                    new TextInput().configure(
                        {
                            property: new StringExpression('turn.productType'),
                            prompt: new ActivityTemplate('${AskForProductTypePrompt()}'),
                            validations: ['(turn.recognized.entities.product[0][0] != null)'],
                            invalidPrompt: new ActivityTemplate('${AskForProductTypePrompt()}'),
                            allowInterruptions: new BoolExpression('=checkForCommissionDialogInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!dialog.productTypeRequired')
                        }
                    ),
                    new CodeAction(this.validateproductType.bind(this))
                ])
            ]
        });

        this.addDialog(commissionDialog);
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
    async handleInitialCommissionFlow(dc, options) {
        console.log('handleInitialCommissionFlow');
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId
        };

        if (commissionObj.carrierName) {
            params.carrierName = commissionObj.carrierName;
        }
        if (commissionObj.productType) {
            params.productType = commissionObj.productType;
        }

        const agentCarriers = await this.getAgentSpecificCarries(dc, apiBaseUrl, authCode, params, true);
        if (!agentCarriers) { // Error getting Carriers for agent
            return dc.endDialog();
        }
        if (params.carrierName && params.productType) {
            if (agentCarriers.length === 1) {
                // Display commission deatails for product type
                await this.handleProductType(dc, commissionObj);
            }
            if (agentCarriers.length > 1) {
                // Display carrier dropdown to choose for displaying
                dc.state.setValue('turn.similarCarrierTitle', params.carrierName);
                await this.displayCarrierDrowpdown(dc, agentCarriers, 'dialog.similarCarrierPrompt');
            }
            return dc.endDialog();
        }
        await this.getAgentCommissionSummaryDetails(dc, apiBaseUrl, authCode, params, agentCarriers);
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
            await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
            return dc.endDialog();
        }

        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId
        };

        // Store carrier name in commission object
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        commissionObj.carrierName = dc.state.getValue('turn.carrierName');
        if (commissionObj.carrierName) {
            params.carrierName = commissionObj.carrierName;
        }
        dc.state.setValue('conversation.commissionObj', commissionObj);
        if (await this.getAgentCommissionSummary(dc, apiBaseUrl, authCode, params)) {
            return dc.endDialog();
        }

        // Product type is given at the begening
        await this.handleProductType(dc, commissionObj);
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

        // Store carrier name in commission object
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        commissionObj.carrierName = dc.state.getValue('turn.carrierName');
        if (commissionObj.carrierName) {
            params.carrierName = commissionObj.carrierName;
        }

        if (commissionObj.productType) {
            params.productType = commissionObj.productType;
        }
        dc.state.setValue('conversation.commissionObj', commissionObj);
        // await this.getAgentCommissionSummary(dc, authCode, params);
        if (await this.getAgentCommissionSummaryDetails(dc, apiBaseUrl, authCode, params, agentCarriers)) {
            return dc.endDialog();
        }

        // Product type is given at the begening
        await this.handleProductType(dc, commissionObj);

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
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        if (dc.state.getValue('turn.recognized.entities.noThanks') != null) {
            // Product type is given at the begening
            await this.handleProductType(dc, commissionObj);
            return dc.endDialog();
        }

        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId,
            carrierName: commissionObj.carrierName
        };
        const agentCarriers = await this.getAgentSpecificCarries(dc, apiBaseUrl, authCode, params, false);
        if (!agentCarriers) {
            return dc.endDialog();
        }
        dc.state.setValue('turn.similarCarrierTitle', commissionObj.carrierName);
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

        // Store carrier name in commission object
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        commissionObj.carrierName = dc.state.getValue('turn.similarCarrierName');
        if (!commissionObj.productType) {
            const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
            const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
            const params = {
                agentId: dc.state.getValue('conversation.displayAgent').agentId,
                carrierName: commissionObj.carrierName
            };
            dc.state.setValue('conversation.commissionObj', commissionObj);
            if (await this.getAgentCommissionSummary(dc, apiBaseUrl, authCode, params)) {
                return dc.endDialog();
            }
        }

        // Product type is given at the begening
        await this.handleProductType(dc, commissionObj);
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
        // Store product type in commission object
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        commissionObj.productType = dc.state.getValue('turn.productType');
        dc.state.setValue('conversation.commissionObj', commissionObj);

        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId,
            carrierName: commissionObj.carrierName,
            productType: commissionObj.productType
        };
        await this.getAgentCommissionSummaryForProductType(dc, apiBaseUrl, authCode, params, false);
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
        console.log('turn.showProductType: ', dc.state.getValue('turn.showProductType'));
        const commissionObj = dc.state.getValue('conversation.commissionObj');

        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId,
            carrierName: commissionObj.carrierName
        };
        await this.getAgentCommissionSummaryForProductType(dc, apiBaseUrl, authCode, params, false);// true
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

        // Store product type in commission object
        const commissionObj = dc.state.getValue('conversation.commissionObj');
        commissionObj.productType = dc.state.getValue('turn.productType');
        dc.state.setValue('conversation.commissionObj', commissionObj);

        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId,
            carrierName: commissionObj.carrierName,
            productType: commissionObj.productType
        };
        await this.getAgentCommissionSummaryForProductType(dc, apiBaseUrl, authCode, params, false, true);
        return dc.endDialog();
    }

    /**
     * Service Methods used for Commission Dialog Flows
     */

    /**
     * Get commission summary details
     * @param {*} dc
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} params
     * @param {*} allowPrompt
     * @param {*} lastPrompt
     * @returns
     */
    async getAgentCommissionSummaryForProductType(dc, apiBaseUrl, authCode, params, allowPrompt, lastPrompt) {
        const commissionDetailForProduct = await this.getCommissionDetailsForCarrier(dc, apiBaseUrl, authCode, params);

        if (!commissionDetailForProduct) {
            return false;
        }

        if (commissionDetailForProduct.length === 0) {
            // Ask product type again
            if (allowPrompt) {
                // Ask for product type again

                const productList = await this.getProductType(apiBaseUrl, authCode, params.agentId, params.carrierName);
                if (await this.checkForError(dc, productList)) {
                    return false;
                }
                await this.displayProductTypeDropdown(dc, productList, 'dialog.checkForProductType');
                return true;

                // dc.state.setValue('dialog.checkForProductType', true);
            } else {
                await dc.context.sendActivity(this.lgFile.evaluate('ProductNotFoundText', dc.context.activity));
                await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
            }
            return false;
        }
        // if(!allowPrompt && commissionDetailForProduct.length > 10
        //         && !await this.handleProductTypeDropdown(dc, authCode, params)){
        //     return false;
        // }

        if (commissionDetailForProduct.length > 10) {
            if (!lastPrompt) {
                await this.handleProductTypeDropdown(dc, apiBaseUrl, authCode, params);
            } else {
                await dc.context.sendActivity(this.lgFile.evaluate('MoreProductTypeForCarrierText', dc.context.activity));
                await this.displayCommissionDetailsProductType(dc, commissionDetailForProduct.slice(0, 10), params.productType, params.carrierName);
                await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
            }
            return;
        }
        await this.displayCommissionDetailsProductType(dc, commissionDetailForProduct, params.productType, params.carrierName);
    }

    /**
     * Get the commission details
     * @param {*} dc
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} params
     * @returns
     */
    async getCommissionDetailsForCarrier(dc, apiBaseUrl, authCode, params) {
        await sendTypingIndicator(dc.context);
        const commissionDetailForProduct = await this.getCommissionDetailsForProductType(apiBaseUrl, authCode, params);
        if (await this.checkForError(dc, commissionDetailForProduct)) {
            return false;
        }

        return commissionDetailForProduct;
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
        const productList = await this.getProductType(apiBaseUrl, authCode, params.agentId, params.carrierName);
        if (await this.checkForError(dc, productList)) {
            return false;
        }
        await this.displayProductTypeDropdown(dc, productList);
        return true;
    }

    /**
     * Handle user given product type
     * @param {*} dc
     * @param {*} commissionObj
     * @returns
     */
    async handleProductType(dc, commissionObj) {
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        const params = {
            agentId: dc.state.getValue('conversation.displayAgent').agentId,
            carrierName: commissionObj.carrierName
        };

        if (!commissionObj.productType) {
            const commissionDetailForProduct = await this.getCommissionDetailsForCarrier(dc, apiBaseUrl, authCode, params);
            if (!commissionDetailForProduct || (commissionDetailForProduct && commissionDetailForProduct.length === 0)) {
                await dc.context.sendActivity(this.lgFile.evaluate('ProductTypeForCarrierNotAvilableText', dc.context.activity));
                await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
                return false;
            }

            dc.state.setValue('dialog.proptForProductType', true);
            return false;
        }

        // Add product name in params
        params.productType = commissionObj.productType;
        return await this.getAgentCommissionSummaryForProductType(dc, apiBaseUrl, authCode, params, true);
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
        const agentCarriers = await this.getCarrierForAgent(apiBaseUrl, authCode, params.agentId, params);
        if (await this.checkForError(dc, agentCarriers)) {
            return null;
        }

        if (params.carrierName && agentCarriers.length === 0) {
            if (allowPrompt) {
                dc.state.setValue('turn.carrierNameTitle', params.carrierName);
                const carrierNameForDisplay = params.carrierName;
                params.carrierName = null;
                const agentCarriersforDropdown = await this.getCarrierForAgent(apiBaseUrl, authCode, params.agentId, params);
                if (!agentCarriersforDropdown) { // No Carriers for agent
                    return null;
                }
                if (agentCarriersforDropdown.length > 0) {
                    await this.displayCarrierDrowpdown(dc, agentCarriersforDropdown, 'dialog.repromptForEmptyCarrier');
                } else {
                    message = `${ dc.state.getValue('conversation.displayAgent.name') } has ${ agentCarriers.length } active contracts for ${ carrierNameForDisplay }`;
                    await dc.context.sendActivity(message);
                }

                // dc.state.setValue('dialog.repromptForEmptyCarrier', true);
            } else {
                await dc.context.sendActivity(this.lgFile.evaluate('CarrierNotFoundText', dc.context.activity));
                await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
            }
            return null;
        }
        return agentCarriers;
    }

    /**
     * Get commission summary
     * @param {*} dc
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} params
     * @returns
     */
    async getAgentCommissionSummary(dc, apiBaseUrl, authCode, params) {
        await sendTypingIndicator(dc.context);
        const commissionSummary = await this.getAgentCommission(apiBaseUrl, authCode, params.agentId, params);
        if (await this.checkForError(dc, commissionSummary)) {
            return true;
        }
        await this.displayCommissionSummery(dc, this.parseCommisonSummary(commissionSummary), params);
        return false;
    }

    /**
     * Get commission details
     * @param {*} dc
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} params
     * @param {*} agentCarriers
     * @returns
     */
    async getAgentCommissionSummaryDetails(dc, apiBaseUrl, authCode, params, agentCarriers) {
        if (await this.getAgentCommissionSummary(dc, apiBaseUrl, authCode, params)) {
            return true;
        }
        if (params.carrierName) {
            if (agentCarriers.length === 1) {
                if (!params.productType) {
                    const commissionDetailForProduct = await this.getCommissionDetailsForCarrier(dc, apiBaseUrl, authCode, params);
                    if (!commissionDetailForProduct || (commissionDetailForProduct && commissionDetailForProduct.length === 0)) {
                        await dc.context.sendActivity(this.lgFile.evaluate('ProductTypeForCarrierNotAvilableText', dc.context.activity));
                        // return false;
                        await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
                        return true;
                    }
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
     * Display commission summary card
     * @param {*} dc
     * @param {*} commissionInfo
     * @param {*} params
     */
    async displayCommissionSummery(dc, commissionInfo, params) {
        console.log('displayCommissionSummery');
        let message = 'The commission summary';
        
        message += ` for ${ dc.state.getValue('conversation.displayAgent').name } `;
        if (params.productType) {
            message += ` for ${ params.productType } `;
        }
        if (params.carrierName) {
            message += ` for ${ params.carrierName } `;
        }
        message += 'is:';
        await dc.context.sendActivity(message);
        await dc.context.sendActivity(await getCommissionCards(commissionInfo));
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
     * Display commission details card
     * @param {*} dc
     * @param {*} commissionDetailsInfo
     * @param {*} productType
     */
    async displayCommissionDetailsProductType(dc, commissionDetailsInfo, productType, carrierName) {
        console.log('commissionDetailsInfo: ', commissionDetailsInfo);
        const commissionDetailsCard = await commissionDetailsTable(commissionDetailsInfo);
        let msg = 'Here is the YTD commission details for ' + carrierName;
        if (productType) {
            msg = msg + `, ${ productType }`;
        }
        msg = msg + ':';
        await dc.context.sendActivity(msg);
        await dc.context.sendActivity(commissionDetailsCard);
        await dc.context.sendActivity(this.lgFile.evaluate('FlowEndMessage', dc.context.activity));
    }

    /**
     * Parse commission summary as required by the card
     * @param {*} commissionSummary
     * @returns
     */
    parseCommisonSummary(commissionSummary) {
        const YTD = {
            group: 'YTD',
            commission: commissionSummary.ytdAmount,
            indicatorURL: (commissionSummary.ytdIndicator === 'Postive') ? UP_ICON : (commissionSummary.ytdIndicator === 'Negative' ? DOWN_ICON : NO_CHANGE_ICON),
            differenceAmount: Math.abs(commissionSummary.ytdAmount - commissionSummary.prevYtdAmount),
            percent: commissionSummary.ytdPercentage,
            message: 'Compared to last year'
        };

        const LTM = {
            group: 'LTM',
            commission: commissionSummary.ltmAmount,
            indicatorURL: (commissionSummary.ltmIndicator === 'Postive') ? UP_ICON : (commissionSummary.ltmIndicator === 'Negative' ? DOWN_ICON : NO_CHANGE_ICON),
            differenceAmount: Math.abs(commissionSummary.ltmAmount - commissionSummary.prevLtmAmount),
            percent: commissionSummary.ltmPercentage,
            message: 'Compared to prior LTM'
        };

        return [YTD, LTM];
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

    /**
     * API Methods used for Commission Dialog Flows
     */

    /**
     * Get commission from API
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} agentID
     * @param {*} params
     * @returns
     */
    async getAgentCommission(apiBaseUrl, authCode, agentID, params) {
        console.log('getAgentCommission');
        try {
            let url = `/api/producer/v${ API_VERSION }/da/commissionsummary?AgentId=${ agentID }`;
            if (params.carrierName || params.productType) {
                if (params.carrierName) {
                    url += `&CarrierName=${ encodeURIComponent(params.carrierName) }`;
                }
                if (params.productType) {
                    url += `&ProductType=${ params.productType }`;
                }
            }
            console.log('getAgentCommission URL', url);
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('Error - getAgentCommission: ', error.response.data);
            if (error.response.status === 400) {
                return {};
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // REMOVE: Mock data
        // return commissionSummary = require('../../bots/resources/mock-data/agentCommissionSummary.json');
    }

    /**
     * Get Carriers from API
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} agentID
     * @param {*} params
     * @returns
     */
    async getCarrierForAgent(apiBaseUrl, authCode, agentID, params) {
        console.log('getCarrierForAgent');
        // Get Carrier for agent API
        try {
            let url = `/api/producer/v${ API_VERSION }/da/carrier?AgentId=${ agentID }`;
            if (params.carrierName) {
                url = url + `&CarrierName=${ params.carrierName }`;
            }
            if (params.productType) {
                url = url + `&ProductType=${ encodeURIComponent(params.productType) }`;
            }
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('DB error - getCarrierForAgent: ', error.response.data);
            if (error.response.status === 400) {
                return [];
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // REMOVE: Mock data
        // if(carrierName){
        //     return require('../../bots/resources/mock-data/carrierListAetna.json');
        // }
        // return require('../../bots/resources/mock-data/carrierList.json');
    }

    /**
     * Get product types from API
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} agentID
     * @param {*} carrierName
     * @returns
     */
    async getProductType(apiBaseUrl, authCode, agentID, carrierName) {
        // Get product type API
        try {
            const url = `/api/producer/v${ API_VERSION }/da/producttypes?AgentId=${ agentID }&CarrierName=${ carrierName }`;
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('DB error - getCarrierForAgent: ', error.response.data);
            if (error.response.status === 400) {
                return [];
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // REMOVE: Mock data
        // return require('../../bots/resources/mock-data/productTypes.json');
    }

    /**
     * Get commission details from API
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} params
     * @returns
     */
    async getCommissionDetailsForProductType(apiBaseUrl, authCode, params) {
        // Get commission details API
        try {
            let url = `/api/producer/v${ API_VERSION }/da/commissiondetails?AgentId=${ params.agentId }&CarrierName=${ params.carrierName }`;
            if (params.productType) {
                url = url + `&ProductType=${ params.productType }`;
            }
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('DB error - getCarrierForAgent: ', error.response.data);
            if (error.response.status === 400) {
                return [];
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // NOTE: Product type is optional

        // REMOVE: mock data
        // return require('../../bots/resources/mock-data/commissionDetails.json');

        // REMOVE: mock data more than 10
        // return require('../../bots/resources/mock-data/moreCommissionDetails.json');

        // REMOVE: mock data 0
        // return [];
    }
}

module.exports.CommissionDialog = CommissionDialog;
