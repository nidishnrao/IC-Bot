/* eslint-disable no-throw-literal */
/* eslint-disable no-template-curly-in-string */
const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * This file contains all the API calls present in Hierarchy dialog
 */

/**
 * Get the List of Carriers for given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getCarriersForAgentAPI(params) {
    console.log('getCarriersForAgentAPI');
    try {
        // URI: /api/producer/v1/da/carrier?AgentId=1234
        let url = `/api/producer/v${ API_VERSION }/da/carrier?AgentId=${ params.agentId }`;
        if (params.carrierName) {
            url = url + `&CarrierName=${ params.carrierName }`;
        }
        if (params.productType) {
            url = url + `&ProductType=${ encodeURIComponent(params.productType) }`;
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

/**
 * Get the List of Contract Details(Status, AWN, and Payout details) for given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getContractDetailsForAgentAPI(params) {
    console.log('getContractDetailsForAgentAPI');

    try {
        // URI: /api/producer/v1/da/payoutdetails?CarrierName=Aetna&AgentId=1234&ProductType=Term
        let url = `/api/producer/v${ API_VERSION }/da/payoutdetails?CarrierName=${ encodeURIComponent(params.carrierName) }&AgentId=${ params.agentId }`;
        if (params.productType) {
            url = url + `&ProductType=${ params.productType }`;
        }
        if (params.contractId) {
            url = url + `&ContractId=${ params.contractId }`;
        }
        return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
    } catch (error) {
        console.log('DB error - getContractDetailsForAgentAPI: ', error.response.data);
        switch (error.response.status) {
        case 401:
            return 'Unauthorized';
        default:
            return 'Error';
        }
    }
}

/* Get the List of Hierarchy Details(top, immidiate upline and downline count) for given agent from backend systems
* @param {*} params
* @returns
*/
async function getHierarchyDetailsAPI(params) {
   console.log('getHierarchyDetailsAPI');

   try {
       // URI: /api/producer/v1/da/hierarchydetails?CarrierName=Aetna&AgentId=1234&HierarchyType=Term
       let url = `/api/producer/v${ API_VERSION }/da/hierarchydetails?CarrierName=${ encodeURIComponent(params.carrierName) }&AgentId=${ params.agentId }&ContractId=${ params.contractId }`;
       if (params.hierarchyType) {
           url = url + `&hierarchyType=${ params.hierarchyType }`;
       }
       return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
   } catch (error) {
       console.log('DB error - getHierarchyDetailsForAgentAPI: ', error.response.data);
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
    getContractDetailsForAgentAPI,
    getHierarchyDetailsAPI
};
