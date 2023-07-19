const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * Get contact information of the given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getProfileInformationAPI(params) {
  console.log('getProfileInformationAPI');
  try {
    let url = `/api/producer/v${API_VERSION}/da/agentProfile?AgentID=${ params.agentId }`;
    
    return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
  } catch (error) {
    console.log('DB error - getProfileInformationAPI: ', error.response.data);
    switch (error.response.status) {
      case 401:
        return 'Unauthorized';
      default:
        return 'Error';
    }
  }
}

module.exports = {
  getProfileInformationAPI
}