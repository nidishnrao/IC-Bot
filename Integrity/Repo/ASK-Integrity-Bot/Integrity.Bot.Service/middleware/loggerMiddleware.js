// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const moment = require('moment');
const { TELEMETRY_EVENT } = require('../core/commons/config');
const { getData, putData } = require('../core/accessors/sessionManagement');
const { sendTypingIndicator } = require('../core/commons/utils');

/**
 * Logs user and bot messages. It filters out ContinueConversation events coming from skill responses.
 */
class LoggerMiddleware {
  constructor(telemetryClient, userState) {
    this.telemetryClient = telemetryClient;
    this.userState = userState;
  }

  async onTurn(turnContext, next) {
    if (turnContext.activity.type === 'message') {
      await this.preIntercept(turnContext);
    }

    // Register outgoing handler.
    turnContext.onSendActivities(await this.outgoingHandler.bind(this));

    // Continue processing messages.
    await next();
  }

  async outgoingHandler(turnContext, activities, next) {
    activities.forEach(async (activity) => {
      if (activity.type === 'message') {
        await this.postIntercept(turnContext, activity);
      }
    });

    await next();
  }

  async preIntercept(turnContext) {
    this.extractDataFromCarrierInfoDropDown(turnContext);
    await sendTypingIndicator(turnContext);
    await this.customTelemetry(turnContext, {}, 'input');
  }

  extractDataFromCarrierInfoDropDown(turnContext) {
    if (turnContext.activity.value) {
      if (turnContext.activity.value && turnContext.activity.value.carrierInfo) {
        turnContext.activity.text = turnContext.activity.value.carrierInfo;
      } else if ((turnContext.activity.value.dropDownInfo && turnContext.activity.value.action) || turnContext.activity.value.action) {
        turnContext.activity.text = turnContext.activity.value.action;
      } else if (turnContext.activity.value.dropDownInfo) {
        turnContext.activity.text = turnContext.activity.value.dropDownInfo;
      }
    }
  }

  async postIntercept(turnContext, activity) {
    await this.customTelemetry(turnContext, activity, 'output');
  }

  async customTelemetry(context, activity, type) {
    const MarketerName = await getData(this.userState, context, 'marketerName'); let turnObj; let entities = null; let intent = null; let intentScore = null; let agentName = null; let agentId = null;
    const hostName = await getData(this.userState, context, 'hostName');
    const hostUrl = await getData(this.userState, context, 'hostUrl');
    // Send Custom Telemetry
    if (type === 'output') {
      let userInputType = null; let userMessage = null;
      if (context._activity.type === 'message' && context._activity.text) {
        userInputType = await getData(this.userState, context, 'inputType');
        userMessage = await getData(this.userState, context, 'originalInput');
      }
      const BotResponse = await this.getBotResponse(activity, context);
      console.log('BotResponse: ', JSON.stringify(BotResponse));
      Array.from(context._turnState.keys()).forEach(async (obj) => {
        turnObj = context._turnState.get(obj);
        if (turnObj && turnObj.state && turnObj.state.displayAgent) {
          agentName = turnObj.state.displayAgent.name;
          agentId = turnObj.state.displayAgent.agentId;
        }
      });
      Array.from(context._turnState.keys()).forEach(async (obj) => {
        turnObj = context._turnState.get(obj);
        if (turnObj && turnObj.recognized) {
          entities = turnObj.recognized.entities;
          delete entities.$instance;
          intent = turnObj.recognized.intent;
          intentScore = turnObj.recognized.score;
        }
      });

      if (BotResponse) {
        await this.telemetryClient.trackEvent({
          name: TELEMETRY_EVENT[hostName],
          properties: {
            HostUrl: hostUrl,
            Type: type,
            MarketerId: context._activity.from.id,
            MarketerName: MarketerName,
            MarketerUtterance: userMessage,
            InputType: userInputType,
            NLU_Intent: intent,
            NLU_IntentScore: intentScore,
            NLU_Entities: entities,
            AgentName: agentName,
            AgentId: agentId,
            BotResponseType: BotResponse.responseType,
            BotResponse: BotResponse.structuredResponse,
            CardId: BotResponse.id ? BotResponse.id : null,
            BotResponseRawData: JSON.stringify(activity),
            ConversationId: context._activity.conversation.id,
            TurnId: context._activity.id,
            Timestamp: moment().format(),
            Channel: context._activity.channelId,
            Recipient: context._activity.recipient.name,
            Locale: context._activity.locale
          }
        });
      }
    } else if (type === 'input') {
      if (context._activity.type === 'message' && context._activity.from.id && context._activity.text) {
        let inputType = 'Text'; const message = context._activity.text;
        await putData(this.userState, context, 'inputType', inputType);
        await putData(this.userState, context, 'originalInput', context._activity.text);
        if (message.includes(' is selected!')) {
          inputType = 'Click';
          await putData(this.userState, context, 'inputType', 'Click');
          context._activity.text = context._activity.text.replace(' is selected!', '');
        }

        await this.telemetryClient.trackEvent({
          name: TELEMETRY_EVENT[hostName],
          properties: {
            HostUrl: hostUrl,
            Type: type,
            MarketerId: context._activity.from.id,
            MarketerName: MarketerName,
            MarketerUtterance: message,
            InputType: inputType,
            ConversationId: context._activity.conversation.id,
            TurnId: context._activity.id,
            Timestamp: moment().format(),
            Channel: context._activity.channelId,
            Recipient: context._activity.recipient.name,
            Locale: context._activity.locale
          }
        });
      }
    }
  }

  async getBotResponse(activity, context) {
    if (activity.text) {
      // Store current bot response
      await putData(this.userState, context, 'msg', activity.text);

      if (!activity.attachments) {
        return {
          responseType: 'Text',
          structuredResponse: activity.text
        };
      } else {
        const responseType = 'Text & ';
        const secondResponse = await this.getCardDetails(activity.attachments);
        return {
          responseType: responseType + secondResponse.responseType,
          structuredResponse: [activity.text, secondResponse.structuredResponse],
          id: secondResponse.id
        };
      }
    } else if (activity.attachmentLayout) {
      if (activity.attachmentLayout === 'list') {
        if (activity.attachments[0].content.id === 'buttons') {
          return await this.getButtonsCardDetails(activity.attachments[0].content);
        } else if (activity.attachments[0].content.id === 'tipCard') {
          return await this.getTipCardDetails(activity.attachments[0].content);
        } else if (activity.attachments[0].content.id === 'dropDownNoThanksCard' || 
        activity.attachments[0].content.id === 'commissionButtons' || 
        activity.attachments[0].content.id === 'payoutTable' || 
        activity.attachments[0].content.id === 'awnTable' || 
        activity.attachments[0].content.id === 'commissionTable' || 
        activity.attachments[0].content.id === 'awn' || 
        activity.attachments[0].content.id === 'showMoreButtons' || 
        activity.attachments[0].content.id === 'statusInfoCard' || 
        activity.attachments[0].content.id === 'hierarchyTable' ||
        activity.attachments[0].content.id === 'productCertification' ||
        activity.attachments[0].content.id === 'carrierCertification' ||
        activity.attachments[0].content.id === 'geoLocationSearch') {
          return await this.getCardDetails(activity.attachments);
        }
      } else if (activity.attachmentLayout === 'carousel') {
        return await this.getCardDetails(activity.attachments);
      }
    } else if (activity.attachments) {
      if (activity.attachments[0].content.id === 'buttons' || activity.attachments[0].content.id === 'commissionButtons' || activity.attachments[0].content.id === 'anotherCarrierConfirmButton') {
        return await this.getButtonsCardDetails(activity.attachments[0].content);
      }
    }
  }

  async getButtonsCardDetails(content) {
    const buttons = [];
    content.actions.forEach(async (action) => {
      buttons.push(action.title);
    });
    return {
      responseType: 'Buttons',
      structuredResponse: buttons,
      id: 'Buttons'
    };
  }

  async getTipCardDetails(content) {
    return {
      responseType: 'ToolTip',
      structuredResponse: content.body[0].columns[1].items[0].text,
      id: 'tipCard'
    };
  }

  async getCardDetails(attachments) {
    const details = []; let info = {};
    if (attachments[0].content.id === 'agentInfoCard') {
      attachments.forEach(async (attachment) => {
        info = {
          firstName: attachment.content.body[0].text,
          lastName: attachment.content.body[1].items[0].text,
          id: attachment.content.body[2].columns[0].items[0].text
        };
        if (attachment.content.body[2].columns[0].items[1].items[0].text !== '') {
          let location = attachment.content.body[2].columns[0].items[1].items[0].text.replace('**', '');
          location = location.replace('**', '');
          info.location = location;
        }
        details.push(info);
      });
      return {
        responseType: 'CarouselCards',
        structuredResponse: details,
        id: 'agentInfoCard'
      };
    } else if (attachments[0].content.id === 'commissionCard') {
      attachments.forEach(async (attachment) => {
        if (attachment.content.body[0].text === 'YTD') {
          info = {
            YTD: {
              ytdAmount: attachment.content.body[1].items[0].items[0].text,
              ytdIndicator: (attachment.content.body[2].items[0].columns[0].items[0].url === 'https://imasva.blob.core.windows.net/imasva-assests/up.png') ? '↑' : (attachment.content.body[2].items[0].columns[0].items[0].url === 'https://imasva.blob.core.windows.net/imasva-assests/down.png' ? '↓' : '⟷'),
              differenceAmt: attachment.content.body[2].items[0].columns[1].items[0].items[0].text,
              note: attachment.content.body[3].items[0].text
            }
          };
        } else if (attachment.content.body[0].text === 'LTM') {
          info = {
            LTM: {
              ltmAmount: attachment.content.body[1].items[0].items[0].text,
              ltmIndicator: (attachment.content.body[2].items[0].columns[0].items[0].url === 'https://imasva.blob.core.windows.net/imasva-assests/up.png') ? '↑' : (attachment.content.body[2].items[0].columns[0].items[0].url === 'https://imasva.blob.core.windows.net/imasva-assests/down.png' ? '↓' : '⟷'),
              differenceAmt: attachment.content.body[2].items[0].columns[1].items[0].items[0].text,
              note: attachment.content.body[3].items[0].text
            }
          };
        }
        details.push(info);
      });
      return {
        responseType: 'CarouselCards',
        structuredResponse: details,
        id: 'commissionCard'
      };
    } else if (attachments[0].content.id === 'carrierCard') {
      attachments.forEach(async (attachment) => {
        attachment.content.actions.forEach(async (action) => {
          if (action.card.body[0].type === 'Input.ChoiceSet') {
            const dropdownValues = [];
            action.card.body[0].choices.forEach(async (choice) => {
              dropdownValues.push(choice.value);
            });
            info = {
              dropdownValues
            };
          } else if (action.type === 'Action.Submit') {
            info = {
              responseType: 'Button',
              structuredResponse: action.data
            };
          }
        });
        details.push(info);
      });
      return {
        responseType: 'DropdownCard',
        structuredResponse: details,
        id: 'carrierCard'
      };
    } else if (attachments[0].content.id === 'dropDownCard') {
      attachments.forEach(async (attachment) => {
        if (attachment.content.body[0].type === 'Input.ChoiceSet') {
          const dropdownValues = [];
          attachment.content.body[0].choices.forEach(async (choice) => {
            dropdownValues.push(choice.title);
          });
          info = {
            dropdownValues
          };
          details.push(info);
        };
        if (attachment.content && attachment.content.actions[0]) {
          if (attachment.content.actions[0].type === 'Action.Submit') {
            info = {
              responseType: 'SubmitIcon'
            };
            details.push(info);
          }
        }
      });
      return {
        responseType: 'DropdownCard',
        structuredResponse: details,
        id: 'dropDownCard'
      };
    } else if (attachments[0].content.id === 'dropDownNoThanksCard') {
      if (attachments[0].content.actions) {
        const buttons = [];
        buttons.push(attachments[0].content.actions[0].title);
        return {
          responseType: 'Buttons',
          structuredResponse: buttons,
          id: 'dropDownNoThanksCard'
        };
      } else {
        attachments.forEach(async (attachment) => {
          attachment.content.body[0].items.forEach(async (item) => {
            if (item.type === 'Input.ChoiceSet') {
              const dropdownValues = [];
              item.choices.forEach(async (choice) => {
                dropdownValues.push(choice.title);
              });
              info = {
                dropdownValues
              };
            } else if (item.type === 'ActionSet') {
              info = {
                responseType: 'SubmitIcon'
              };
            }
            details.push(info);
          });
          if (attachment.content && attachment.content.actions && attachment.content.actions[0]) {
            if (attachment.content.actions[0].iconUrl) {
              info = {
                responseType: 'SubmitIcon'
              };
              details.push(info);
            }
          }
        });
      }
      return {
        responseType: 'DropdownCard',
        structuredResponse: details,
        id: 'dropDownNoThanksCard'
      };
    } else if (attachments[0].content.id === 'commissionButtons') {
      return await this.getButtonsCardDetails(attachments[0].content);
    } else if (attachments[0].content.id === 'commissionDetails') {
      attachments.forEach(async (attachment) => {
        info = {
          productName: attachment.content.body[0].text,
          commissionAmount: attachment.content.body[2].items[0].text,
          level: attachment.content.body[1].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'CarouselCards',
        structuredResponse: details,
        id: 'commissionDetails'
      };
    } else if (attachments[0].content.id === 'productLevel') {
      attachments.forEach(async (attachment) => {
        info = {
          productName: attachment.content.body[0].text,
          level: attachment.content.body[1].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'CarouselCards',
        structuredResponse: details,
        id: 'productLevel'
      };
    } if (attachments[0].content.id === 'commissionTable') {
      attachments[0].content.body[1].items.forEach(async (value) => {
        info = {
          ProductType: value.columns[0].items[0].text,
          Commission: value.columns[1].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'commissionTable'
      };
    } else if (attachments[0].content.id === 'payoutTable') {
      attachments[0].content.body[1].items.forEach(async (value) => {
        info = {
          ProductType: value.columns[0].items[0].text,
          PayoutLevel: value.columns[1].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'payoutTable'
      };
    } else if (attachments[0].content.id === 'awnTable') {
      const ContractDetails = {};
      ContractDetails.Status = (attachments[0].content.body[0].items[0].items[0].columns[0].items[0].columns[0].items[3].items[0].text ? attachments[0].content.body[0].items[0].items[0].columns[0].items[0].columns[0].items[3].items[0].text : (attachments[0].content.body[0].items[0].items[0].columns[0].items[0].columns[0].items[4].items[0].items[0].items[0].text ? attachments[0].content.body[0].items[0].items[0].columns[0].items[0].columns[0].items[4].items[0].items[0].items[0].text : attachments[0].content.body[0].items[0].items[0].columns[0].items[0].columns[0].items[4].items[0].items[0].items[0].items[0].text));
      ContractDetails.StatusReason = attachments[0].content.body[0].items[0].items[0].columns[0].items[1].columns[0].items[0].columns[0].items[0].text;
      ContractDetails.Effective = attachments[0].content.body[0].items[0].items[0].columns[0].items[1].columns[0].items[0].columns[0].items[1].items[0].text;
      details.push(ContractDetails);
      const awn = [];
      attachments[0].content.body[2].items.forEach(async (value) => {
        info = {
          AWN: value.columns[0].items[0].text,
          Type: value.columns[1].items[0].items[0].text
        };
        awn.push(info);
      });
      details.push(awn);
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'awnTable'
      };
    } else if (attachments[0].content.id === 'awn') {
      attachments[0].content.body[1].items.forEach(async (value) => {
        info = value.columns[0].items[0].text;
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'awn'
      };
    } else if (attachments[0].content.id === 'showMoreButtons') {
      const buttons = [];
      attachments[0].content.body[0].items[0].actions.forEach(async (action) => {
        buttons.push(action.title);
      });
      attachments[0].content.body[0].items[1].items[0].items[0].actions[0].card.actions.forEach(async (action) => {
        buttons.push(action.title);
      });
      return {
        responseType: 'Buttons',
        structuredResponse: buttons,
        id: 'Buttons'
      };
    } else if (attachments[0].content.id === 'statusInfoCard') {
      await attachments.forEach(async (attachment) => {
        info = {
          Status: attachment.content.body[0].items[0].items[0].columns[0].items[3].items[0].text ? attachment.content.body[0].items[0].items[0].columns[0].items[3].items[0].text : (attachment.content.body[0].items[0].items[0].columns[0].items[4].items[0].items[0].items[0].text ? attachment.content.body[0].items[0].items[0].columns[0].items[4].items[0].items[0].items[0].text : attachment.content.body[0].items[0].items[0].columns[0].items[5].items[0].items[0].items[0].items[0].text),
          StatusReason: attachment.content.body[0].items[1].columns[0].items[0].text,
          StartDate: attachment.content.body[0].items[1].columns[0].items[1].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'ContractsCarousel'
      };
    } else if (attachments[0].content.id === 'hierarchyTable') {
      attachments.forEach(attachment => {
        info = {
          toh: attachment.content.body[0].columns[1].items[0].text,
          immediateUpline: attachment.content.body[1].columns[1].items[0].text,
          downlineCount: attachment.content.body[2].columns[1].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'hierarchyTable'
      };
    } else if (attachments[0].content.id === 'productCertification') {
      attachments[0].content.body[1].items.forEach(item => {
        info = {
          product: item.columns[0].items[0].text,
          year: item.columns[1].items[0].items[0].text,
          certificationDate: item.columns[1].items[1].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'productCertification'
      }
    } else if (attachments[0].content.id === 'carrierCertification') {
      attachments[0].content.body[1].items.forEach(item => {
        info = {
          carrier: item.columns[0].items[0].text,
          product: item.columns[1].items[0].items[0].text,
          year: item.columns[2].items[0].items[0].items[0].text,
          certificationDate: item.columns[2].items[1].items[0].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'carrierCertification'
      }
    } else if (attachments[0].content.id === 'geoLocationSearch') {
      attachments[0].content.body[1].items.forEach(item => {
        info = {
          agentId: item.columns[0].items[0].text,
          agentName: item.columns[1].items[0].items[0].text,
          cityAndState: item.columns[2].items[0].items[0].items[0].text
        };
        details.push(info);
      });
      return {
        responseType: 'Table',
        structuredResponse: details,
        id: 'geoLocationSearch'
      }
    } else return {};
  }
}

module.exports.LoggerMiddleware = LoggerMiddleware;
