/* eslint-disable no-undef */
var moment = require('moment');
const AXIOS = require('axios');
const { getButtonsCard,
    getAgentInfoCard,
    adaptiveCard,
    getTipAdaptiveCard,
    getAgentCommissionCard,
    getCommissionDetailsTable,
    getProductLevelTable,
    getAwnDetailsTable,
    getnoThanksCard,
    getStatusCard,
    getOnlyAWNCard,
    getHierarchyDetailsTable,
    getProductCertificationDetailsTable,
    getCarrierCertificationDetailsTable,
    getContactInfoDetailsTable,
    getAddressDetailsTable,
    getpolicyLookupStatusDetailsTable, 
    getAgentGeolocationDetailsTable,
    getPolicyCommissionDetailsTable } = require('../../bots/resources/adaptive-cards');
const URLPARSE = require('url-parse');

/**
 * Used for time based greeting
 * @returns
 */
async function getTimeBoundGreetings() {
  var currentHour = moment().utcOffset('-05:00').format('HH');
  var greeting = 'Evening';
  if (currentHour < 12) {
    greeting = 'Morning';
  } else if (currentHour >= 12 && currentHour < 16) {
    greeting = 'Afternoon';
  }
  return greeting;
}

/**
 * All below methds are used for setting up Adaptive cards
 */
async function getAdaptiveCardButtons(buttonsArray) {
  const values = await convertButtonsArrayToJSON(buttonsArray);
  const card = await getButtonsCard(values);
  return await adaptiveCard(card, false);
}

async function convertButtonsArrayToJSON(buttonsArray) {
  const JSON = [];
  for (values of buttonsArray) {
    JSON.push({ value: values });
  }
  return JSON;
}

async function getTipCard(tip) {
  const card = await getTipAdaptiveCard(tip);
  return await adaptiveCard(card, false);
}

async function getAgentFromList(AgentList, param, value) {
  const agentObj = [];
  value && AgentList.forEach(agent => {
    if ((agent[param]).toString().toLowerCase().includes(value.toString().toLowerCase())) {
      agentObj.push(agent);
    } else if (param === 'stateCode' && agent.state.toString().toLowerCase().includes(value.toString().toLowerCase())) {
      agentObj.push(agent);
    }
  });
  return agentObj;
}

async function createAgentInfoCards(agentList) {
  const carouselCards = [];
  await agentList.forEach(async (element) => {
    carouselCards.push(await getAgentInfoCard(element));
  });
  return await adaptiveCard(carouselCards, true);
}

async function getCommissionCards(commissionInfo) {
  const carouselCards = [];
  await commissionInfo.forEach(async (element) => {
    carouselCards.push(await getAgentCommissionCard(element));
  });
  return await adaptiveCard(carouselCards, true);
}

async function commissionDetailsTable(info) {
  return await adaptiveCard(await getCommissionDetailsTable(info), false);
}

async function productLevelTable(info) {
  return await adaptiveCard(await getProductLevelTable(info), false);
}

async function awnDetailsTable(info) {
  return await adaptiveCard(await getAwnDetailsTable(info), false);
}

async function hierarchyDetailsTable(info, agentId) {
  return await adaptiveCard(await getHierarchyDetailsTable(info, agentId), false);
}

async function contactInfoDetailsTable(info) {
    return await adaptiveCard(await getContactInfoDetailsTable(info), false);
}

async function addressDetailsTable(info) {
    return await adaptiveCard(await getAddressDetailsTable(info), false);
}

async function noThanksCard() {
  return await adaptiveCard(await getnoThanksCard(), false);
}

async function getStatusCards(statusInfo) {
  const carouselCards = [];
  for (const element of statusInfo) {
    carouselCards.push(await getStatusCard(element));
  }
  return await adaptiveCard(carouselCards, true);
}

async function onlyAWNCard(info) {
  return await adaptiveCard(await getOnlyAWNCard(info), false);
}

async function productCertificationDetailsTable(info) {
  return await adaptiveCard(await getProductCertificationDetailsTable(info), false);
}

async function carrierCertificationDetailsTable(info) {
  return await adaptiveCard(await getCarrierCertificationDetailsTable(info), false);
}

async function policyLookupStatusDetailsTable(info) {
  return await adaptiveCard(await getpolicyLookupStatusDetailsTable(info), false);
}
async function searchAgentsByGeolocationTable(info, agentGeoLocObj) {
  return await adaptiveCard(await getAgentGeolocationDetailsTable(info, agentGeoLocObj), false);
}
async function policyCommissionDetailsTable(info) {
  return await adaptiveCard(await getPolicyCommissionDetailsTable(info), false);
}

async function getAxiosReq(API_BASE_URL, authCode, url, params) {
  const urlParse = URLPARSE(API_BASE_URL, true);
  console.log('API URL: ', url);
  console.log('API Params: ', params);

  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    const headers = { accept: 'text/plain', authorization: authCode, HOSTNAME: urlParse.hostname };
    console.log('API Headers: ', headers);

    const instance = AXIOS.create({
      baseURL: API_BASE_URL,
      headers: headers
    });

    if (params) {
      instance.params(params);
    }

    await instance.get(url)
      .then(function (response) {
        console.log('API post response.data: ', response.data);
        resolve(response.data);
      }).catch(function (error) {
        reject(error);
      });
  });
}

async function sendTypingIndicator(context) {
  await context.sendActivity({ type: 'typing' });
}

module.exports = {
    getTimeBoundGreetings,
    getAdaptiveCardButtons,
    getTipCard,
    getAgentFromList,
    createAgentInfoCards,
    getCommissionCards,
    commissionDetailsTable,
    productLevelTable,
    awnDetailsTable,
    getAxiosReq,
    sendTypingIndicator,
    noThanksCard,
    getStatusCards,
    onlyAWNCard,
    hierarchyDetailsTable,
    productCertificationDetailsTable,
    carrierCertificationDetailsTable,
    contactInfoDetailsTable,
    addressDetailsTable,
    policyLookupStatusDetailsTable,
    searchAgentsByGeolocationTable,
    policyCommissionDetailsTable
};
