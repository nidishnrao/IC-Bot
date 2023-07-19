
const { getAxiosReq } = require('../../core/commons/utils');
const { API_VERSION } = require('../../core/commons/config');

/**
 * This file contains all the API calls present in Certification dialog
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
        let url = `/api/producer/v${API_VERSION}/da/carrier?AgentId=${params.agentId}&requestFor=Certification`;
        if (params.carrierName) {
            url = url + `&CarrierName=${params.carrierName}`;
        }
        if (params.productType) {
            url = url + `&ProductType=${encodeURIComponent(params.productType)}`;
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
 * Get the List of Product Types for given agent from backend systems
 * @param {*} params
 * @returns
 */
async function getProductTypeForAgentAPI(params) {
    console.log('getProductTypeForAgentAPI');

    try {
        // URI: /api/producer/v1/da/producttypes?AgentId=1234&CarrierName=Aetna
        let url = `/api/producer/v${API_VERSION}/da/producttypes?AgentId=${params.agentId}&CarrierName=${encodeURIComponent(params.carrierName)}`;
        if (params.contractId) {
            url = url + `&ContractId=${params.contractId}`;
        }
        return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
    } catch (error) {
        console.log('DB error - getProductTypeForAgentAPI: ', error.response.data);
        switch (error.response.status) {
            case 401:
                return 'Unauthorized';
            default:
                return 'Error';
        }
    }
}

/**
 * Get the List of Product Types for given agent for all carriers from backend systems
 * @param {*} params
 * @returns
 */
async function getProductTypeForCertificationAPI(params) {
    console.log('getProductTypeForCertificationAPI');

    try {
        // URI: /api/producer/v1/da/producttypes?AgentId=1234&CarrierName=Aetna
        let url = `/api/producer/v${API_VERSION}/da/productTypesForCertification?AgentId=${params.agentId}`;
        return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
    } catch (error) {
        console.log('DB error - getProductTypeForCertificationAPI: ', error.response.data);
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
        let url = `/api/producer/v${API_VERSION}/da/payoutdetails?CarrierName=${encodeURIComponent(params.carrierName)}&AgentId=${params.agentId}`;
        if (params.productType) {
            url = url + `&ProductType=${params.productType}`;
        }
        if (params.contractId) {
            url = url + `&ContractId=${params.contractId}`;
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


/**
 * Get the List of Certification details for given agent from backend systems
 * @param {*} params
 * @returns
 */

async function getCertificationsAPI(params) {
    try {
        let url = `/api/producer/v${API_VERSION}/da/agentCertifications?AgentId=${params.agentId}`
        if (params.productType) {
            url = url + `&ProductType=${params.productType}`;
        }
        if (params.carrierName) {
            url = url + `&CarrierName=${params.carrierName}`;
        }
        if (params.year) {
            url = url + `&Year=${params.year}`;
        }
        return await getAxiosReq(params.apiBaseUrl, params.authCode, url);
    }
    catch (error) {
        console.log('DB error - getContractDetailsForAgentAPI: ', error.response.data);
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
    getProductTypeForAgentAPI,
    getContractDetailsForAgentAPI,
    getCertificationsAPI,
    getProductTypeForCertificationAPI
};