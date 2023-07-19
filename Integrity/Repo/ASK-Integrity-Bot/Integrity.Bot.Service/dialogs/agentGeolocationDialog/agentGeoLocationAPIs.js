const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * This file contains all the API calls present in agent geolocation dialog
 */

/**
 * Get the List of Carriers for given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getCarriersForAgentAPI(params) {
  console.log('getCarriersForAgentAPI');
  try {
    let url = `/api/producer/v${API_VERSION}/da/allCarriers`;

    return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
  } catch (error) {
    console.log('DB error - getCarriersForAgentAPI: ', error.response.data);
    switch (error.response.status) {
      case 401:
        return 'Unauthorized';
      default:
        return 'Error';
    }
  }
}

/**
 * API to get agents by geolocation
 */
async function getAgentsByGeoLocationAPI(params) {
  console.log('getAgentsByGeoLocation');
  try {
    let url = `/api/producer/v${API_VERSION}/da/agentsByGeolocation?ZipCode=${params.zipCode}&Carrier=${params.carrierName}`;

    if (params.distance) {
      url = url + `&distanceToBeCovered=${params.distance}`;
    }

    return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
  } catch (error) {
    console.log('DB error - getAgentsByGeoLocation: ', error.response.data);
    switch (error.response.status) {
      case 401:
        return 'Unauthorized';
      default:
        return 'Error';
    }
  }
}

/**
 * API to Download agents by geolocation
 */
async function getAgentsByGeoLocationReportAPI(params) {
  console.log('getAgentsByGeoLocationReport');
  try {
    let url = `/api/producer/v${API_VERSION}/da/generate?ZipCode=${params.zipCode}&Carrier=${params.carrierName}`;

    if (params.distance) {
      url = url + `&distanceToBeCovered=${params.distance}`;
    }

    return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
  } catch (error) {
    console.log('DB error - getAgentsByGeoLocation: ', error.response.data);
    switch (error.response.status) {
      case 401:
        return 'Unauthorized';
      default:
        return 'Error';
    }
  }
}

module.exports = {
  getCarriersForAgentAPI,
  getAgentsByGeoLocationAPI,
  getAgentsByGeoLocationReportAPI
}