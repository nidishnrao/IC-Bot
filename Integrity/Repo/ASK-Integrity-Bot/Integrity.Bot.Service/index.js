/* eslint-disable no-undef */
// Import required packages
const path = require('path');

// Note: Ensure you have a .env file and include LuisAppId, LuisAPIKey and LuisAPIHostName.
const ENV_FILE = path.join(__dirname, '.env');
require('dotenv').config({ path: ENV_FILE });

const restify = require('restify');

// Import required bot services.
const { BotFrameworkAdapter, ConversationState, InputHints, MemoryStorage, UserState } = require('botbuilder');

const { ApplicationInsightsTelemetryClient, TelemetryInitializerMiddleware } = require('botbuilder-applicationinsights');
const { TelemetryLoggerMiddleware } = require('botbuilder-core');

// Direct line token generators
const generateDirectLineTokenFunction = require('./core/direct-line/generateDirectLineToken');
const renewDirectLineTokenFunction = require('./core/direct-line/renewDirectLineToken.js');

// This bot's main dialog.
const { DialogBot } = require('./bots/dialogBot');
const { RootDialog } = require('./dialogs/rootDialog/rootDialog');

// Create adapter
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword
});

// Creates a new TelemetryClient based on a instrumentation key
function getTelemetryClient(instrumentationKey) {
    if (instrumentationKey) {
        return new ApplicationInsightsTelemetryClient(instrumentationKey);
    }
    return new NullTelemetryClient();
}

// Add telemetry middleware to the adapter middleware pipeline
var telemetryClient = getTelemetryClient(process.env.InstrumentationKey);
var telemetryLoggerMiddleware = new TelemetryLoggerMiddleware(telemetryClient, true);
var initializerMiddleware = new TelemetryInitializerMiddleware(telemetryLoggerMiddleware, true);
adapter.use(initializerMiddleware);

// Catch-all for errors.
const onTurnErrorHandler = async (context, error) => {
    // This check writes out errors to console log .vs. app insights
    console.error(error);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    let onTurnErrorMessage = 'The bot encountered an error or bug.';
    await context.sendActivity(onTurnErrorMessage, onTurnErrorMessage, InputHints.ExpectingInput);
    onTurnErrorMessage = 'To continue to run this bot, please fix the bot source code.';
    await context.sendActivity(onTurnErrorMessage, onTurnErrorMessage, InputHints.ExpectingInput);
    // Clear out state
    await conversationState.delete(context);
};

// Set the onTurnError for the singleton BotFrameworkAdapter.
adapter.onTurnError = onTurnErrorHandler;

// For local development, in-memory storage is used.
const memoryStorage = new MemoryStorage();
const conversationState = new ConversationState(memoryStorage);
const userState = new UserState(memoryStorage);

// Use the logger middleware to log messages. The default logger argument for LoggerMiddleware is Node's console.log().
const { LoggerMiddleware } = require('./middleware/loggerMiddleware');
adapter.use(new LoggerMiddleware(telemetryClient, userState));

// Create the main dialog.
const dialog = new RootDialog(userState);
dialog.telemetryClient = telemetryClient;
const bot = new DialogBot(conversationState, userState, dialog);

// Create HTTP server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function() {
    console.log(`\n${ server.name } listening to ${ server.url }`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

// Listen for incoming activities and route them to your bot main dialog.
server.post('/api/messages', (req, res) => {
    const d1 = new Date();
    console.log('start time: ', d1.toLocaleString('en-US'));
    // Route received a request to adapter for processing
    adapter.processActivity(req, res, async (turnContext) => {
        // route to bot activity handler.
        await bot.run(turnContext);
        const d2 = new Date();
        console.log('end time: ', d2.toLocaleString('en-US'));
        console.log('Time diff in sec: ', (d2.getTime() - d1.getTime()) / 1000 % 60);
    });
});

// Listen for directline token requests.
server.post('/directline/token', async (req, res) => {
    const origin = req.header('origin');

    // if (!trustedOrigin(origin)) {
    //   return res.send(403, 'not trusted origin');
    // }

    const { token } = req.query;
    const { DIRECT_LINE_SECRET } = process.env;
    const userID = JSON.parse(req.body).marketerId;
    console.log('userID: ', userID);
    try {
        if (token) {
            res.send(await renewDirectLineTokenFunction.renewDirectLineToken(token), { 'Access-Control-Allow-Origin': '*' });
        } else {
            res.send(await generateDirectLineTokenFunction.generateDirectLineToken(DIRECT_LINE_SECRET, userID), { 'Access-Control-Allow-Origin': '*' });
        }
    } catch (err) {
        res.send(500, err.message, { 'Access-Control-Allow-Origin': '*' });
    }

    if (token) {
        console.log(`Refreshing Direct Line token for ${ origin }`);
    } else {
        console.log(
            `Requesting Direct Line token for ${ origin } using secret "${ DIRECT_LINE_SECRET.substr(
                0,
                3
            ) }...${ DIRECT_LINE_SECRET.substr(-3) }"`
        );
    }
});

// Enable the Application Insights middleware, which helps correlate all activity
// based on the incoming request. Used for telemetry part
server.use(restify.plugins.bodyParser());
