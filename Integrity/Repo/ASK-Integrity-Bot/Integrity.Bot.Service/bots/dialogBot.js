const { ActivityHandler } = require('botbuilder');
const { DialogManager } = require('botbuilder-dialogs');

const { getTimeBoundGreetings, getAdaptiveCardButtons, getTipCard } = require('../core/commons/utils');

const { putData } = require('../core/accessors/sessionManagement');

class DialogBot extends ActivityHandler {
    /**
     *
     * @param {Dialog} dialog
     */
    constructor(conversationState, userState, dialog) {
        super();

        this.userState = userState;
        this.conversationState = conversationState;
        this.dialog = dialog;
        this.dialogState = this.conversationState.createProperty('DialogState');

        if (!conversationState) throw new Error('[DialogBot]: Missing parameter. conversationState is required');
        if (!userState) throw new Error('[DialogBot]: Missing parameter. userState is required');
        if (!dialog) throw new Error('[DialogBot]: Missing parameter. dialog is required');

        this.dialogManager = new DialogManager(dialog);
        this.dialogManager.conversationState = conversationState;
        this.dialogManager.userState = userState;

        this.onEvent(async (context, next) => {
            await SendWelcome(context, this.userState);
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            await this.dialogManager.onTurn(context);
            await next();
        });

        this.onMessage(async (context, next) => {
            await this.dialogManager.onTurn(context);
            await next();
        });

        async function SendWelcome(context, userState) {
            if (context.activity.name === 'webchat/join') {
                const marketerName = (context.activity.value || {}).marketerName;
                const marketerId = (context.activity.value || {}).marketerId;
                const authorization = (context.activity.value || {}).authorization;
                const hostUrl = (context.activity.value || {}).hostUrl;
                const hostName = (context.activity.value || {}).host;
                await putData(userState, context, 'marketerName', marketerName);
                await putData(userState, context, 'marketerId', marketerId);
                await putData(userState, context, 'authorization', authorization);
                await putData(userState, context, 'hostUrl', hostUrl);
                await putData(userState, context, 'hostName', hostName);
                console.log("hi time",context.activity.timestamp)
                console.log("hi activity",context.activity)
                const welcomeOptions = ['Agent Info'];

                // let displayTime = (context.activity.rawLocalTimestamp.substring(11, 13)) * 1;
                const timestamp = context.activity.timestamp;
                const dateObject = new Date(timestamp);
                let displayTime = dateObject.getHours();

                console.log(displayTime, "hours");
                console.log("hi time is",displayTime)
                let greeting = 'Evening';
                if (displayTime < 12) {
                    greeting = 'Morning';
                    console.log("hi morning")
                } else if (displayTime >= 12 && displayTime < 16) {
                    greeting = 'Afternoon';
                    console.log("hi afternoon")
                }
                else{
                    console.log("hi night")
                }

                // const welcomeOptions = ['Agent Info', 'Reminders', 'Service Tickets'];
                const welcomeOptionButtons = await getAdaptiveCardButtons(welcomeOptions);
                // console.log('welcomeOptionButtons: ', welcomeOptionButtons);
                const tipMessage = 'You can also type a question to get started.';
                const tipCard = await getTipCard(tipMessage);
                await context.sendActivities([
                    {
                        type: 'message',
                        textFormat: 'markdown',
                        // eslint-disable-next-line no-useless-escape
                        text: `Good ${greeting} **${marketerName}!**\r\nI\'m your virtual assistant. How can I help you?`
                    },
                    { type: 'message', text: 'Most of the users need help with one of the following topics.' },
                    tipCard,
                    welcomeOptionButtons
                ]);
            }
        }
    }

    /**
     * Override the ActivityHandler.run() method to save state changes after the bot logic completes.
     */
    async run(context) {
        await super.run(context);

        // Save any state changes. The load happened during the execution of the Dialog.
        await this.conversationState.saveChanges(context, false);
        await this.userState.saveChanges(context, false);
    }
}

module.exports.DialogBot = DialogBot;
