const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * Get contact information of the given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getContactInformationAPI(params) {
  console.log('getContactInformationAPI');
  try {
    let url = `/api/producer/v${API_VERSION}/da/agentContact?AgentID=${params.agentId}`;
    if (params.contactType) {
      url += `&ContactType=${params.contactType}`;
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
  getContactInformationAPI
}