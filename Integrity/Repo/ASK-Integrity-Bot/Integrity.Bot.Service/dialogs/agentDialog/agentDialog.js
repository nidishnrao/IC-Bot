/* eslint-disable no-mixed-operators */
/* eslint-disable camelcase */
/* eslint-disable no-throw-literal */
/* eslint-disable no-template-curly-in-string */
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

const { getData } = require('../../core/accessors/sessionManagement');
const { API_VERSION } = require('../../core/commons/config');

const {
    getAgentFromList,
    getAdaptiveCardButtons,
    createAgentInfoCards,
    getAxiosReq,
    sendTypingIndicator
} = require('../../core/commons/utils');

const DIALOG_ID = 'AGENT_DIALOG';
const NAMEINPUT_DIALOG_ID = 'NAMEINPUT_DIALOG';

const SETAGENTNAME = 'agent.setAgentName';

/**
 * This dialog is used to identify the agent
 */
class AgentDialog extends ComponentDialog {
    userState;
    lgFile;
    generatorTemplate;

    constructor(userState) {
        super(DIALOG_ID);

        this.userState = userState;
        this.lgFile = Templates.parseFile(path.join(__dirname, 'agentDialog.lg'));
        this.generatorTemplate = new TemplateEngineLanguageGenerator(this.lgFile);

        // Custom function to extract agent name
        Expression.functions.add(SETAGENTNAME, (args) => {
            console.log('Arguments 1', args)
            console.log('\nsetAgentName - personName: ', args[0]);
            console.log('setAgentName - agentName: ', args[1]);
            console.log('@agentNameLN_FN', args[2]);

            let personName = args[1];
            if (args[0]) {
                personName = args[0];
            }
            if (args[0] && args[2]) {
                const name = args[2].split(',');
                personName = name[1].trim() + ' ' + name[0].trim();
            }
            console.log('Agent name: ', personName);
            return personName;
        });

        // Custom function to extract agent location
        Expression.functions.add('validateAgentState', (args) => {
            console.log('Arguments 2', args)
            console.log('\nsetAgentLocation - geographyV2: ', args[0]);
            console.log('setAgentLocation - stateCode: ', args[1]);
            console.log('setAgentLocation - location: ', args[2]);
            return true;
        });

        // Custom function for interrupt
        Expression.functions.add('checkForInterrupt', (args) => {
            console.log('\nturn.recognized: ', args[0]);
            if ((args[0].Help && args[0].Help.score >= 0.8) || (args[0].StartOver && args[0].StartOver.score >= 0.8)) {
                return true;
            }
            return false;
        });

        // Agent dialog triggers
        const agentDialog = new AdaptiveDialog(DIALOG_ID).configure({
            generator: this.generatorTemplate, // new TemplateEngineLanguageGenerator(this.lgFile),
            recognizer: this.createLuisRecognizer(),
            triggers: [
                new OnBeginDialog([
                    // Remove old state and city
                    new DeleteProperty('conversation.dummyAgentState'),
                    new DeleteProperty('conversation.AgentCityName'),
                    new DeleteProperty('conversation.agentName'),

                    // Extract values given at the start
                    new SetProperties([
                        {
                            property: new StringExpression('dialog.agentId'),
                            value: new ValueExpression('=@number')
                        }
                    ]),
                    new SetProperties([
                        {
                            property: new StringExpression('dialog.agentName'),
                            value: new ValueExpression(`=${SETAGENTNAME}(@agentName, @personName, @agentNameLN_FN)`)
                        }
                    ]),
                    new SetProperties([
                        {
                            property: new StringExpression('dialog.agentLocation'),
                            value: new ValueExpression('=coalesce(@geographyV2, @stateCode, @location)')
                        }
                    ]),

                    new SetProperties([
                        {
                            property: new StringExpression('dialog.certificationYear'),
                            value: new ValueExpression('=@datetime.timex[0]')
                        }
                    ]),

                    new CodeAction(this.validateAgent.bind(this)),

                    // Used for Agent name Prompt
                    new IfCondition().configure({
                        condition: new BoolExpression('conversation.agentNameRequired'),
                        actions: [
                            new BeginDialog('NAMEINPUT_DIALOG')
                        ]
                    }),

                    // Ask for state
                    new TextInput().configure(
                        {
                            property: new StringExpression('conversation.dummyAgentState'),
                            prompt: new ActivityTemplate('${AskStatePrompt()}'),
                            validations: ['(turn.recognized.entities.geographyV2!=null) || (turn.recognized.entities.stateCode!=null) || (turn.recognized.entities.location!=null)'],
                            invalidPrompt: new ActivityTemplate('${InValidStateText()}'),
                            allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)'), // false
                            disabled: new BoolExpression('!conversation.agentStateRequired')
                        }
                    ),
                    new CodeAction(this.validateState.bind(this)),

                    // Ask state for second time
                    new DeleteProperty('conversation.dummyAgentState'),

                    new DeleteProperty('turn.recognized.entities.geographyV2'),
                    new DeleteProperty('turn.recognized.entities.stateCode'),
                    new DeleteProperty('turn.recognized.entities.location'),

                    new TextInput().configure(
                        {
                            property: new StringExpression('conversation.dummyAgentState'),
                            prompt: new ActivityTemplate('${NoAgentsFoundInLocationText()}'),
                            validations: ['(turn.recognized.entities.geographyV2!=null) || (turn.recognized.entities.stateCode!=null) || (turn.recognized.entities.location!=null)'],
                            invalidPrompt: new ActivityTemplate('${InValidStateText()}'),
                            allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!conversation.agentStateRequired')
                        }
                    ),
                    new CodeAction(this.validateState.bind(this)),

                    // ask for city
                    new TextInput().configure(
                        {
                            property: new StringExpression('conversation.AgentCityName'),
                            prompt: new ActivityTemplate('${AskCityPrompt()}'),
                            // validations :['(turn.recognized.entities.geographyV2!=null) || (turn.recognized.entities.stateCode!=null) || (turn.recognized.entities.location!=null)'],
                            invalidPrompt: new ActivityTemplate('${NoAgentsFoundInLocationText()}'),
                            allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!conversation.agentCityRequired')
                        }
                    ),
                    new CodeAction(this.validateCity.bind(this)),

                    // Ask state for city time
                    new DeleteProperty('conversation.AgentCityName'),

                    new TextInput().configure(
                        {
                            property: new StringExpression('conversation.AgentCityName'),
                            prompt: new ActivityTemplate('${NoAgentsFoundInLocationText()}'),
                            // validations :['(turn.recognized.entities.geographyV2!=null) || (turn.recognized.entities.stateCode!=null) || (turn.recognized.entities.location!=null)'],
                            invalidPrompt: new ActivityTemplate('${NoAgentsFoundInLocationText()}'),
                            allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)'),
                            disabled: new BoolExpression('!conversation.agentCityRequired')
                        }
                    ),
                    new CodeAction(this.validateCity.bind(this)),

                    // Display Agent
                    new CodeAction(this.displayAgentInBot.bind(this)),
                    new IfCondition().configure({
                        condition: new BoolExpression('conversation.displayAgent'),
                        actions: [
                            new SwitchCondition('conversation.currentFlow',
                                [
                                    new SendActivity('${FoundAgentText()}' + '${FoundAgentPostText()}'),
                                    new SendActivity('${AgentInfoText()}'),
                                    new SendActivity('${SelectedAgentMenuText()}'),
                                    new SendActivity('${AgentMenu()}'),
                                    new SendActivity({ type: 'event', name: 'hideSendBox' })
                                ],
                                [
                                    new Case('Commission', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('COMMISSION_DIALOG')
                                    ]),
                                    new Case('Contract', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('CONTRACT_DIALOG')
                                    ]),
                                    new Case('Hierarchy', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('HIERARCHY_DIALOG')
                                    ]),
                                    new Case('ProductCertification', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('PRODUCT_CERTIFICATION_DIALOG')
                                    ]),
                                    new Case('CarrierCertification', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('CARRIER_CERTIFICATION_DIALOG')
                                    ]),
                                    new Case('ContactInformation', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('CONTACT_INFORMATION_DIALOG')
                                    ]),
                                    new Case('Address', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('ADDRESS_DIALOG')
                                    ]),
                                    new Case('ProfileInformation', [
                                        new CodeAction(this.clearFlow.bind(this)),
                                        new BeginDialog('PROFILE_INFORMATION_DIALOG')
                                    ])
                                ]
                            )
                        ]
                    }),
                    new IfCondition().configure({
                        condition: new BoolExpression('turn.noAgentFound'),
                        actions: [
                            new SendActivity('${DidNotFindAgentText()}'),
                            new SendActivity('${DidNotFindAgentPost()}')
                        ]
                    }),
                    new EndDialog()
                ])
                // TODO: Other Intents
            ]
        });

        // Name or ID Input prompt
        const nameInputDialog = new AdaptiveDialog(NAMEINPUT_DIALOG_ID).configure({
            generator: this.generatorTemplate,
            recognizer: this.createLuisRecognizer(),
            triggers: [
                new OnBeginDialog([
                    // Ask for Name
                    new DeleteProperty('conversation.agentName'),
                    new TextInput().configure(
                        {
                            property: new StringExpression('conversation.agentName'),
                            prompt: new ActivityTemplate('${AskAgentNamePrompt()}'),
                            invalidPrompt: new ActivityTemplate('${AskAgentText()}'),
                            allowInterruptions: new BoolExpression('=checkForInterrupt(turn.recognized.intents)') // false

                        }
                    ),
                    new CodeAction(this.ValidateAgentInNamePrompt.bind(this)),
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

        this.addDialog(agentDialog);
        this.addDialog(nameInputDialog);
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
     * Extract state and city from entities
     * @param {*} dc
     * @param {*} entity
     * @returns
     */
    async extractStateNCityEntity(dc, entity) {
        console.log('extractStateNCityEntity - entity: ', entity);
        const entities = { state: '', city: '', stateCode: '' };
        console.log('entity.geographyV2: ', entity.geographyV2);
        entity.geographyV2 && entity.geographyV2.forEach(geoV2Obj => {
            switch (geoV2Obj.type) {
                case 'countryRegion':
                case 'state':
                    entities.state = geoV2Obj.location;
                    break;
                case 'city':
                    entities.city = geoV2Obj.location;
                    break;
            }
        });

        if (entity.stateCode) {
            entities.stateCode = entity.stateCode[0][0];
        }

        entity.location && entity.location.forEach(param => {
            if (entities.state.toLowerCase() !== param.toLowerCase() &&
                entities.city.toLowerCase() !== param.toLowerCase() &&
                entities.stateCode.toLowerCase() !== param.toLowerCase()) {
                if (entities.city === '') {
                    entities.city = param;
                } else if (entities.state === '') {
                    entities.state = param;
                }
            }
        });
        if ((dc.state.getValue('turn.fromBeginning') && entity.agentName &&
            (entity.personName && entity.personName === entity.agentName) &&
            entity.agentName.includes(entities.city))
        ) {
            entities.city = '';
        }
        console.log('entities: ', entities);
        return entities;
    }

    /**
     * Store the LUIS extracted values in agent object
     * @param {*} dc
     * @param {*} agentObj
     * @returns
     */
    async updateAgentObjWIthLUISEntities(dc, agentObj) {
        const entities = dc.state.getValue('turn').recognized.entities;
        const luisEntities = await this.extractStateNCityEntity(dc, entities);
        console.log('luisEntities: ', luisEntities);
        // TODO Merge Agent Obj and luisEntities dynamically
        if (luisEntities.state || luisEntities.stateCode) {
            agentObj.agentState = luisEntities.state;
            if (!agentObj.agentState) {
                agentObj.agentState = luisEntities.stateCode;
            }
        }
        if (luisEntities.city) {
            if (!agentObj.agentName.includes(luisEntities.city)) {
                agentObj.agentCity = luisEntities.city;
            }
        }
        dc.state.setValue('turn.fromBeginning', true);
        return agentObj;
    }

    /**
     * Validation for agent ID
     * @param {*} dc
     * @param {*} options
     * @param {*} agentObj
     * @returns
     */
    async agentValidationById(dc, options, agentObj) {
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        if (!agentObj.agentId && !agentObj.agentName) {
            console.log('Agent is EMPTY');
            dc.state.setValue('conversation.displayAgent', null);

            if ((dc.state.getValue('conversation.currentFlow') === 'Commission') ||
                (dc.state.getValue('conversation.currentFlow') === 'Contract') ||
                (dc.state.getValue('conversation.currentFlow') === 'Hierarchy') ||
                (dc.state.getValue('conversation.currentFlow') === 'ProductCertification') ||
                (dc.state.getValue('conversation.currentFlow') === 'CarrierCertification') ||
                (dc.state.getValue('conversation.currentFlow') === 'AddressDialog') ||
                (dc.state.getValue('conversation.currentFlow') === 'ContactInformationDialog')) {
                // await dc.context.sendActivity(this.lgFile.evaluate('AskAgentFromOtherFlowsText', dc.context.activity));
                dc.state.setValue('conversation.askAgentFromOtherFlows', true);
                dc.state.setValue('conversation.agentNameRequired', true);
                return true;
            }
            // await dc.context.sendActivity(this.lgFile.evaluate('AskAgentText', dc.context.activity));
            await sendTypingIndicator(dc.context);
            const recentAgentList = await this.getRecentAgentForUser(apiBaseUrl, authCode);
            if (recentAgentList) {
                if (await this.checkForError(dc, recentAgentList)) {
                    return dc.endDialog();
                }
                if (recentAgentList.length > 0) {
                    // await this.displayAgentListToUser(dc, recentAgentList, 'RecentAgentsText');

                    // Added New ---------------------
                    await dc.context.sendActivity(this.lgFile.evaluate('AskAgentText', dc.context.activity));
                    const parcedRecentAgentList = [];
                    recentAgentList.forEach((details) => {
                        parcedRecentAgentList.push({
                            agentId: (details.agentId ? details.agentId.toString() : ' '),
                            agentFirstName: (details.firstName ? details.firstName : ' '),
                            agentLastName: (details.lastName ? details.lastName : ' '),
                            stateCode: (details.stateCode ? (details.city ? ', ' : ' ') + details.stateCode : ' '),
                            city: (details.city ? details.city : ' ')
                        });
                    });
                    dc.state.setValue('conversation.recentAgentFound', true);
                    dc.state.setValue('conversation.cardValues', parcedRecentAgentList);
                    dc.state.setValue('conversation.agentNameRequired', true);
                } else {
                    // No Recent agents found
                    // await dc.context.sendActivity(this.lgFile.evaluate('NoRecentAgentsText', dc.context.activity));

                    // Added New ---------------------
                    dc.state.setValue('conversation.recentAgentFound', false);
                    dc.state.setValue('conversation.agentNameRequired', true);
                }
            } else {
                // TODO: handle error
            }
            return true;
        }

        if (agentObj.agentId) {
            console.log('Agent Id: ', agentObj.agentId);
            await sendTypingIndicator(dc.context);
            const agentData = await this.getAgentById(apiBaseUrl, authCode, agentObj.agentId);
            if (agentData) {
                if (await this.checkForError(dc, agentData)) {
                    return true;
                }
                if (Object.keys(agentData).length === 0) {
                    console.log('No Data for ', agentObj.agentId);
                    dc.state.setValue('conversation.displayAgent', null);
                    await dc.context.sendActivity(this.lgFile.evaluate('NoAgentFoundText', dc.context.activity));
                } else {
                    console.log('agentData: ', agentData);
                    dc.state.setValue('conversation.displayAgent', agentData);
                    dc.state.setValue('conversation.agentObj', null);
                }
            } else {
                // TODO: Handle DB Error
            }
            return true;
        }
        return false;
    }

    /**
     * Handle Change agent Flow
     * @param {*} dc
     * @returns
     */
    async changeAgent(dc) {
        console.log('Change agent');
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        await sendTypingIndicator(dc.context);
        const recentAgentList = await this.getRecentAgentForUser(apiBaseUrl, authCode);
        if (recentAgentList) {
            if (await this.checkForError(dc, recentAgentList)) {
                return dc.endDialog();
            }
            if (recentAgentList.length > 0) {
                await this.displayAgentListToUser(dc, recentAgentList, 'ChangeAgentTextWithRecent');
            } else {
                await dc.context.sendActivity(this.lgFile.evaluate('ChangeAgentText', dc.context.activity));
            }
        } else {
            // TODO: Handle DB error
        }
    }

    /**
     * Validation for Agent basedon user provided data
     * @param {*} dc
     * @param {*} options
     * @returns
     */
    async validateAgent(dc, options) {
        this.resetFlags(dc);
        dc.state.setValue('conversation.agentNameRequired', false);
        await dc.context.sendActivity({ type: 'event', name: 'hideAgent' }); // Hide previous agent
        const { agentId, certificationYear } = dc.state.getValue('dialog')
        if (certificationYear && agentId) {
            if (agentId === (certificationYear * 1)) {
                dc.state.setValue('dialog.agentId', undefined);
            }
        }
        let agentObj = {
            agentId: dc.state.getValue('dialog.agentId'),
            agentName: dc.state.getValue('dialog.agentName'),
            agentLocation: dc.state.getValue('dialog.agentLocation')
        };
        const agentNameIgnore = ['agent info',
            'agent contract',
            'awn',
            'agent awn',
            'agent upline',
            'upline',
            'agent toh',
            'agents awn',
            'updated awn',
            'hierarchy',
            'topOfHierarchy',
            'top of hierarchy',
            'toh',
            'TOH',
            'ImmediateUpline',
            'immediate upline',
            'downline count',
            'DownlineCount'];
        if (agentNameIgnore.includes(agentObj.agentName)) {
            agentObj.agentName = null; // Remove agent info as name
        }

        if (agentObj.agentId === 0) {
            agentObj.agentId = '' + agentObj.agentId;
        }

        if (dc.state.getValue('turn').recognized.intent === 'ChangeAgent') {
            await this.changeAgent(dc);
            return dc.endDialog();
        }

        const isOthersFlow = (dc.state.getValue('turn').recognized.intent === 'Other');
        if (isOthersFlow) {
            agentObj = dc.state.getValue('conversation.agentObj');
        }
        console.log('agentObj: ', agentObj);
        agentObj.stateCounter = 0;
        agentObj.cityCounter = 0;
        dc.state.setValue('conversation.agentStateRequired', false);
        dc.state.setValue('conversation.agentCityRequired', false);

        // Ask for agent details
        if (await this.agentValidationById(dc, options, agentObj)) {
            return dc.endDialog();
        }

        await this.getAentNameValidation(dc, isOthersFlow, agentObj);
        return dc.endDialog();
    }

    resetFlags(dc) {
        dc.state.setValue('conversation.recentAgentFound', false); // Dont display recent agents
        dc.state.setValue('conversation.askAgain', false); // Default dont ask again
        dc.state.setValue('conversation.repeat', false);
        dc.state.setValue('conversation.askAgentFromOtherFlows', false);
    }

    /**
     * Agent name prompt to support agency names
     * @param {*} dc
     * @param {*} options
     * @returns
     */
    async ValidateAgentInNamePrompt(dc, options) {
        // Reset all Values
        this.resetFlags(dc);
        console.log('Inside TestName');
        const userInput = dc.state.getValue('conversation.agentName');
        console.log('userInput: ', userInput);
        let agentID;
        let agentName;
        let agentObj = {};
        const LUIS_agentId = dc.state.getValue('turn').recognized.entities;
        // Check if input is a number
        if (LUIS_agentId.number) {
            agentID = LUIS_agentId.number[0];
            console.log('Agent id: ', agentID);
            agentObj = {
                agentId: agentID
            };
            await this.agentValidationByIdPrompt(dc, agentObj);
            return dc.endDialog();
        }

        agentName = userInput;
        if (userInput.includes(',')) {
            const name = userInput.split(',');
            const firstNameCount = this.wordCount(name[1].trim());
            const lastNameCount = this.wordCount(name[0].trim());

            if ((firstNameCount === 1) && (lastNameCount === 1)) {
                agentName = name[1].trim() + ' ' + name[0].trim();
            }
        }
        console.log('agentName: ', agentName);
        agentObj = {
            agentName: agentName
        };
        console.log('agentObj: ', agentObj);

        // Agent name logic
        await this.getAentNameValidation(dc, false, agentObj, true);
        return dc.endDialog();
    }

    /**
     * Count number of words in a string
     * @param {*} text
     * @returns
     */
    wordCount(text = '') {
        return text.split(/\S+/).length - 1;
    };

    /**
     * Agent name validation
     * @param {*} dc
     * @param {*} isOthersFlow
     * @param {*} agentObj
     * @param {*} fromPrompt
     * @returns
     */
    async getAentNameValidation(dc, isOthersFlow, agentObj, fromPrompt = false) {
        agentObj = await this.updateAgentObjWIthLUISEntities(dc, agentObj);
        console.log('agentObj: ', agentObj);

        const userInput = dc.state.getValue('turn').recognized.text.toLowerCase();
        const ignoreCode = ['me', 'in'];
        ignoreCode.forEach(
            (item) => {
                if ((userInput.indexOf(item) !== 0 && userInput.indexOf(item) !== (userInput.length - 2))) {
                    if (agentObj.agentState && agentObj.agentState.toLowerCase() === item) {
                        agentObj.agentState = null;
                        agentObj.agentLocation = null;
                    }
                }
            }
        );

        const ignoreCodeAtStart = ['hi'];
        ignoreCodeAtStart.forEach(
            (item) => {
                if ((userInput.indexOf(item) !== (userInput.length - 2))) {
                    if (agentObj.agentState && agentObj.agentState.toLowerCase() === item) {
                        agentObj.agentState = null;
                        agentObj.agentLocation = null;
                    }
                }
            }
        );

        const params = { name: agentObj.agentName, state: agentObj.agentState, city: agentObj.agentCity };
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        await sendTypingIndicator(dc.context);
        const agentDataArr = await this.getAgentDetails(apiBaseUrl, authCode, params);
        if (agentDataArr) {
            if (await this.checkForError(dc, agentDataArr)) {
                return true;
            }
        }
        if (!agentDataArr || Object.keys(agentDataArr).length === 0) {
            // TODO: Handle DB error
        }

        if (!isOthersFlow && await this.fetchAgentsFromBrowserHistory(dc, agentDataArr)) {
            dc.state.setValue('conversation.agentObj', agentObj);
            return true;
        }

        console.log('params-1: ', params);
        if (await this.fetchAgentsFromDB(dc, agentDataArr, 'NoAgentFoundText', agentObj, fromPrompt)) {
            dc.state.setValue('conversation.agentObj', agentObj);
            return true;
        }
        if (!agentObj.agentState) {
            dc.state.setValue('conversation.displayAgent', null);
            dc.state.setValue('conversation.agentObj', agentObj);
            dc.state.setValue('conversation.agentStateRequired', true);
            return true;
        }
        if (await this.fetchAgentsFromDB(dc, agentDataArr, 'InValidStateText', agentObj, fromPrompt)) {
            return true;
        }
        if (!agentObj.agentCity) {
            dc.state.setValue('conversation.displayAgent', null);
            dc.state.setValue('conversation.agentObj', agentObj);
            dc.state.setValue('conversation.agentCityRequired', true);
            return true;
        }
        await this.fetchAgentsFromDB(dc, agentDataArr, 'NoAgentsFoundInLocationText', agentObj, fromPrompt);
        return true;
    }

    /**
     * Agent id validation
     * @param {*} dc
     * @param {*} agentObj
     * @returns
     */
    async agentValidationByIdPrompt(dc, agentObj) {
        console.log('Agent Id: ', agentObj.agentId);
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        await sendTypingIndicator(dc.context);
        const agentData = await this.getAgentById(apiBaseUrl, authCode, agentObj.agentId);
        if (await this.checkForError(dc, agentData)) {
            return true;
        }
        if (Object.keys(agentData).length === 0) {
            console.log('No Data for ', agentObj.agentId);
            dc.state.setValue('conversation.displayAgent', null);
            dc.state.setValue('conversation.askAgain', true);
            dc.state.setValue('conversation.repeat', true);
        } else {
            console.log('agentData: ', agentData);
            dc.state.setValue('conversation.displayAgent', agentData);
            dc.state.setValue('conversation.agentObj', null);
        }
        return true;
    }

    /**
     * Agent state validation
     * @param {*} dc
     * @param {*} options
     * @returns
     */
    async validateState(dc, options) {
        if (!dc.state.getValue('conversation.agentStateRequired')) {
            return dc.endDialog();
        }
        const agentObj = dc.state.getValue('conversation.agentObj');
        console.log('validateState - agentObj: ', agentObj);
        dc.state.setValue('conversation.agentStateRequired', false);

        const entities = dc.state.getValue('turn').recognized.entities;
        const luisEntities = await this.extractStateNCityEntity(dc, entities);
        agentObj.agentState = luisEntities.state;
        if (!agentObj.agentState) {
            agentObj.agentState = luisEntities.stateCode;
        }
        if (luisEntities.city) {
            agentObj.agentCity = luisEntities.city;
        }

        if (!agentObj.agentState) {
            if (agentObj.stateCounter === 0) {
                dc.state.setValue('conversation.agentStateRequired', true);
                agentObj.stateCounter = agentObj.stateCounter + 1;
            } else {
                dc.state.setValue('turn.noAgentFound', true);
            }

            return dc.endDialog();
        }

        const params = { name: agentObj.agentName, state: agentObj.agentState, city: agentObj.agentCity };
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        await sendTypingIndicator(dc.context);
        const agentDataArr = await this.getAgentDetails(apiBaseUrl, authCode, params);
        if (agentDataArr) {
            if (await this.checkForError(dc, agentDataArr)) {
                return dc.endDialog();
            }
        }
        if (!agentDataArr || Object.keys(agentDataArr).length === 0) {
            // TODO: Handle DB error
        }

        if (await this.fetchAgentsFromDB(dc, agentDataArr, 'InValidStateText', agentObj)) {
            dc.state.setValue('conversation.agentObj', agentObj);
            return dc.endDialog();
        }

        if (!agentObj.agentCity) {
            dc.state.setValue('conversation.displayAgent', null);
            dc.state.setValue('conversation.agentObj', agentObj);
            dc.state.setValue('conversation.agentCityRequired', true);
            return dc.endDialog();
        }

        await this.fetchAgentsFromDB(dc, agentDataArr, 'NoAgentsFoundInLocationText', agentObj);
        return dc.endDialog();
    }

    /**
     * Agent city validation
     * @param {*} dc
     * @param {*} options
     * @returns
     */
    async validateCity(dc, options) {
        if (!dc.state.getValue('conversation.agentCityRequired')) {
            return dc.endDialog();
        }

        const agentObj = dc.state.getValue('conversation.agentObj');
        console.log('validateCity - agentObj: ', agentObj);
        dc.state.setValue('conversation.agentCityRequired', false);

        // UNCOMMENT: If city validation is needed
        // const entities = dc.state.getValue('turn').recognized.entities;
        // let luisEntities = await this.extractStateNCityEntity(dc, entities);
        // if(luisEntities.state || luisEntities.stateCode){
        //     agentObj.agentState = luisEntities.state;
        //     if(!agentObj.agentState){
        //         agentObj.agentState = luisEntities.stateCode;
        //     }
        // }
        // agentObj.agentCity = luisEntities.city;

        console.log('City is: ', dc.state.getValue('conversation.AgentCityName'));

        agentObj.agentCity = dc.state.getValue('conversation.AgentCityName');

        if (!agentObj.agentCity) {
            if (agentObj.cityCounter === 0) {
                dc.state.setValue('conversation.agentCityRequired', true);
                agentObj.cityCounter = agentObj.cityCounter + 1;
            } else {
                dc.state.setValue('turn.noAgentFound', true);
            }
            return dc.endDialog();
        }

        const params = { name: agentObj.agentName, state: agentObj.agentState, city: agentObj.agentCity };
        const authCode = dc.context.activity.channelData.authToken; // await getData(this.userState, dc.context, 'authorization');
        const apiBaseUrl = await getData(this.userState, dc.context, 'hostUrl');
        await sendTypingIndicator(dc.context);
        const agentDataArr = await this.getAgentDetails(apiBaseUrl, authCode, params);
        if (agentDataArr) {
            if (await this.checkForError(dc, agentDataArr)) {
                return dc.endDialog();
            }
        }
        if (!agentDataArr || Object.keys(agentDataArr).length === 0) {
            // TODO: Handle DB error
        }
        await this.fetchAgentsFromDB(dc, agentDataArr, 'NoAgentsFoundInLocationText', agentObj);
        dc.state.setValue('conversation.agentObj', agentObj);
        return dc.endDialog();
    }

    /**
     * Fetch the agent from Browsing histroy
     * @param {*} dc
     * @param {*} agentDataArr
     * @returns
     */
    async fetchAgentsFromBrowserHistory(dc, agentDataArr) {
        dc.state.setValue('conversation.displayAgent', null);
        if (agentDataArr.recentlyContactedCount > 0) {
            // Uncomment for auto select
            if (agentDataArr.recentlyContactedCount == 1) {
                console.log('Inside Recent Agent List only 1 record for ', agentDataArr.recentlyContacted[0].name);
                dc.state.setValue('conversation.displayAgent', agentDataArr.recentlyContacted[0]);
                dc.state.setValue('conversation.agentObj', null);
                return true;
            }
            console.log('Inside Recent Agent List more than 1 record for ', agentDataArr.recentlyContacted[0].name);
            const otherOptionButtons = await getAdaptiveCardButtons(['Others']);
            await this.displayAgentListToUser(dc, agentDataArr.recentlyContacted, 'RecentInteractionsAgentText');
            await dc.context.sendActivity(this.lgFile.evaluate('OthersText', dc.context.activity));
            await dc.context.sendActivities([otherOptionButtons]);
            dc.state.setValue('turn.hideSend', true);
            return true;
        }
        console.log('No Data in browser history');
        return false;
    }

    /**
     * Fetch the agent from DB
     * @param {*} dc
     * @param {*} agentDataArr
     * @param {*} invalidLgText
     * @param {*} agentObj
     * @returns
     */
    async fetchAgentsFromDB(dc, agentDataArr, invalidLgText, agentObj, fromPrompt = false) {
        if (agentDataArr.databaseCount === 0) {
            dc.state.setValue('conversation.displayAgent', null);
            dc.state.setValue('conversation.agentObj', agentObj);

            if (invalidLgText === 'InValidStateText' && agentObj.stateCounter === 0) {
                dc.state.setValue('conversation.agentStateRequired', true);
                agentObj.stateCounter = agentObj.stateCounter + 1;
            } else if (invalidLgText === 'NoAgentsFoundInLocationText' && agentObj.cityCounter === 0) {
                dc.state.setValue('conversation.agentCityRequired', true);
                agentObj.cityCounter = agentObj.cityCounter + 1;
            } else {
                if (fromPrompt) {
                    dc.state.setValue('conversation.displayAgent', null);
                    dc.state.setValue('conversation.askAgain', true);
                    dc.state.setValue('conversation.repeat', true);
                } else {
                    dc.state.setValue('turn.noAgentFound', true);
                }
            }
            return true;
        }
        if (agentDataArr.databaseCount === 1) {
            dc.state.setValue('conversation.displayAgent', agentDataArr.database[0]);
            dc.state.setValue('conversation.agentObj', null);
            return true;
        }
        if (invalidLgText === 'NoAgentsFoundInLocationText' || agentDataArr.databaseCount > 1 && agentDataArr.databaseCount <= 10) {
            if (agentDataArr.databaseCount > 10) {
                // If More than 10 agents found after giving city.
                const message = `I have found too many agents(${agentDataArr.databaseCount}) to show here for the matching query. Click Start Over to restart the conversation.`;
                await dc.context.sendActivity(message);
                return true;
            }
            const message = `I found ${agentDataArr.databaseCount} agents matching your query. Select one to see details.`;
            await dc.context.sendActivity(message);
            await this.displayAgentListToUser(dc, agentDataArr.database);
            dc.state.setValue('turn.hideSend', true);
            return true;
        }
        return false;
    }

    /**
     * Display the agent select card to user
     * @param {*} dc
     * @param {*} agentList
     * @param {*} message
     * @returns
     */
    async displayAgentListToUser(dc, agentList, message) {
        const agentsCards = await createAgentInfoCards(agentList);

        dc.state.setValue('conversation.displayAgent', null);
        await dc.context.sendActivity({ type: 'event', name: 'hideAgent' });
        if (message) {
            await dc.context.sendActivity(this.lgFile.evaluate(message, dc.context.activity));
        }
        await dc.context.sendActivity(agentsCards);
    }

    /**
     * Send event to display the agent in UI
     * @param {*} dc
     * @param {*} options
     * @returns
     */
    async displayAgentInBot(dc, options) {
        const agent = dc.state.getValue('conversation.displayAgent');
        if (agent) {
            await dc.context.sendActivity({
                type: 'event',
                name: 'displayAgent',
                value: {
                    agentId: agent.agentId,
                    agentName: agent.name
                }
            });
            dc.state.setValue('conversation.agentObj', null);
        } else {
            await dc.context.sendActivity({ type: 'event', name: 'hideAgent' });
        }
        if (dc.state.getValue('turn.hideSend')) { // TODO: If hide send box than hide it
            await dc.context.sendActivity({ type: 'event', name: 'hideSendBox' });
        }
        return dc.endDialog();
    }

    /**
     * Get agent by ID API call
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} id
     * @returns
     */
    async getAgentById(apiBaseUrl, authCode, id) {
        try {
            const url = `/api/producer/v${API_VERSION}/da/` + id;
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('DB error - getAgentById: ', error.response.status);
            if (error.response.status === 400 || error.response.status === 500) {
                return {};
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // Remove: Used for local testing using mock JSON
        // let agentArray = require('../../bots/resources/mock-data/db-agents.json');
        // agentArray = await getAgentFromList(agentArray, 'agentId', id);
        // if(agentArray.length > 0){
        //     return agentArray[0];
        // }
        // return {};
    }

    /**
     * Get recent agents API call
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @returns
     */
    async getRecentAgentForUser(apiBaseUrl, authCode) {
        try {
            const url = `/api/producer/v${API_VERSION}/da/recentagents`;
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('DB error - getRecentAgentForUser: ', error.response.data);
            if (error.response.status === 400) {
                return [];
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // Remove: Used for local testing using mock JSON
        // console.log('recent agent');
        // return require('../../bots/resources/mock-data/recent-agents.json');
    }

    /**
     * Get Agent by name, state and city API call
     * @param {*} apiBaseUrl
     * @param {*} authCode
     * @param {*} params
     * @returns
     */
    async getAgentDetails(apiBaseUrl, authCode, params) {
        try {
            let url = `/api/producer/v${API_VERSION}/da/agents?AgentName=` + params.name;
            if (params.state) {
                url = url + '&State=' + params.state;
            }
            if (params.city) {
                url = url + '&City=' + params.city;
            }
            return await getAxiosReq(apiBaseUrl, authCode, url);
        } catch (error) {
            console.log('DB error - getRecentAgentForUser: ', error.response.data);
            if (error.response.status === 400) {
                return {};
            }
            if (error.response.status === 401) {
                return 'unauthorized';
            }
            return null;
        }

        // Remove: Used for local testing using mock JSON
        // let agentBHArray = require('../../bots/resources/mock-data/browser-history-agents.json');
        // let agentDBArray = require('../../bots/resources/mock-data/db-agents.json');
        // agentBHArray = await this.getAgentsFromMockArray(agentBHArray, params);
        // agentDBArray = await this.getAgentsFromMockArray(agentDBArray, params);
        // return {
        //     "recentlyContactedCount": agentBHArray.length,
        //     "recentlyContacted": agentBHArray,
        //     "databaseCount": agentDBArray.length,
        //     "database": agentDBArray
        // }
    }

    // Remove: Used for local testing using mock JSON
    /**
     * Mock data used for testing
     * @param {*} agentArray
     * @param {*} params
     * @returns
     */
    async getAgentsFromMockArray(agentArray, params) {
        if (params.name) {
            agentArray = await getAgentFromList(agentArray, 'name', params.name);
        }
        if (params.state) {
            agentArray = await getAgentFromList(agentArray, 'stateCode', params.state);
        }
        if (params.city) {
            agentArray = await getAgentFromList(agentArray, 'city', params.city);
        }
        console.log('agentArray: ', agentArray.length);
        return agentArray;
    }

    /**
     * Clear current flow
     * @param {*} dc
     * @param {*} options
     * @returns
     */
    async clearFlow(dc, options) {
        dc.state.setValue('conversation.currentFlow', null);
        return dc.endDialog();
    }

    /**
     * Check for API error
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

module.exports.AgentDialog = AgentDialog;
