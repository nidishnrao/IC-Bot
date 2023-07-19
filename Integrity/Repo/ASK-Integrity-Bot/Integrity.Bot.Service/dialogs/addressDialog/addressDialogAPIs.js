const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * Get address of the given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getAddressAPI(params) {
  console.log('getAddressAPI');
  try {
    let url = `/api/producer/v${API_VERSION}/da/agentaddress?AgentID=${ params.agentId }`;

    if (params.addressType) {
      url += `&addressType=${ params.addressType }`;
    }

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

module.exports = {
  getAddressAPI
}