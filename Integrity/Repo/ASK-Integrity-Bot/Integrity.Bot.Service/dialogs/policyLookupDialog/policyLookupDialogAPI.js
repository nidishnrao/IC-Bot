const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * This file contains all the API calls present in Policy Lookup Dialog
 */

/**
 * Get the List of Carriers for given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getPolicyLookupStatusAPI(params) {
  console.log('getPolicyLookupStatusAPI');
  try {
    let url = `/api/producer/v${API_VERSION}/da/policy?PolicyNumber=${params.policyNumber}`;
    
    if (params.policyId) {
      url = url + `&policyId=${params.policyId}`;
    }

    return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
  } catch (error) {
    console.log('DB error - getCarriersForAgentAPI: ', error.message);
    switch (error.code) {
      case 401:
        return 'Unauthorized';
      default:
        return 'Error';
    }
  }
}

/**
 * Get the policy commission details for given policy ID from backend systems
 * @param {*} params
 * @returns
 */
 async function getPolicyCommissionDetailsAPI(params) {
  console.log('getPolicyCommissionDetailsAPI');
  try {
    let url = `/api/producer/v${API_VERSION}/da/policyCommission?PolicyID=${params.policyId}`;

    return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
  } catch (error) {
    console.log('DB error - getPolicyCommissionDetailsAPI: ', error.response.data);
    switch (error.response.status) {
      case 401:
        return 'Unauthorized';
      default:
        return 'Error';
    }
  }
}

module.exports = {
  getPolicyLookupStatusAPI,
  getPolicyCommissionDetailsAPI
};