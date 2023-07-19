const { CardFactory, MessageFactory } = require('botbuilder');
const ACData = require('adaptivecards-templating');
const moment = require('moment');

const buttonsCardJSON = require('./adaptiveCardsButtons.json');
const tipCardJSON = require('./tip.json');
const topAgentsJSON = require('./display-top-agents.json');
const commissionSummaryJSON = require('./commissionSummary.json');
const commissionDetailsTableJSON = require('./commissionDetailsTable.json');
const productLevelTableJSON = require('./productLevelTable.json');
const awnDetailsTableJSON = require('./awnDetailsTable.json');
const noThanksJSON = require('./noThanks.json');
const statusCardJSON = require('./display-status.json');
const onlyAWNJSON = require('./onlyAWN.json');
const hierarchyDetailsTableJSON = require('./hierarchyDetailsTable.json');
const productCertificationJSON = require('./productCertification.json');
const carrierCertificationJSON = require('./carrierCertification.json');
const contactInfoJSON = require('./contactInfoTable.json');
const addressJSON = require('./addressTable.json');
const policyLookupStatusJSON = require('./policyLookupStatus.json');
const agentGeolocationJSON = require('./agentGeolocation.json');
const policyCommissionTableJSON = require('./policyCommissionTable.json');


/**
 * All below methods are used for displaying adaptive cards
 */

async function getButtonsCard(details) {
    var buttonsCardTemplate = new ACData.Template(buttonsCardJSON);
    var buttonsCard = buttonsCardTemplate.expand({
        $root: {
            properties: details
        }
    });
    return buttonsCard;
}

async function getTipAdaptiveCard(tip) {
    var tipsCardTemplate = new ACData.Template(tipCardJSON);
    var tipsCard = tipsCardTemplate.expand({
        $root: {
            properties: {
                tip: tip
            }
        }
    });
    return tipsCard;
}

async function getnoThanksCard() {
    var noThanksTemplate = new ACData.Template(noThanksJSON);
    var noThanksCard = noThanksTemplate.expand({
        $root: {
            properties: null
        }
    });
    return noThanksCard;
}

async function getAgentInfoCard(details) {
    const agentInfoTemplate = new ACData.Template(topAgentsJSON);
    const agentInfoCard = agentInfoTemplate.expand({
        $root: {
            properties: {
                agentId: (details.agentId ? details.agentId.toString() : ' '),
                agentFirstName: (details.firstName ? details.firstName : ' '),
                agentLastName: (details.lastName ? details.lastName : ' '),
                stateCode: (details.stateCode ? (details.city ? ', ' : '') + details.stateCode : ' '),
                city: (details.city ? details.city : ' ')
            }
        }
    });
    return agentInfoCard;
}

async function getAgentCommissionCard(details) {
    var agentCommissionTemplate = new ACData.Template(commissionSummaryJSON);
    var agentCommissionCard = agentCommissionTemplate.expand({
        $root: {
            properties: {
                group: details.group,
                commission: details.commission >= 0 ? '$' + (Number.parseFloat(details.commission).toFixed(2)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-$' + (Math.abs(Number.parseFloat(details.commission).toFixed(2))).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','),
                indicatorURL: details.indicatorURL,
                differenceAmount: '$' + (Number.parseFloat(details.differenceAmount).toFixed(2)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','),
                percent: '(' + Math.abs(details.percent) + '%)',
                message: details.message
            }
        }
    });
    return agentCommissionCard;
}

async function getProductLevelTable(details) {
    details = details.productDetails;
    var productLevelTableTemplate = new ACData.Template(productLevelTableJSON);
    var productLevelTable = productLevelTableTemplate.expand({
        $root: {
            properties: details
        }
    });
    return productLevelTable;
}

async function getAwnDetailsTable(details) {
    const stDate = details.startDate;
    const enDate = details.endDate;
    await details.awnDetails.forEach(async (element) => {
        if (!element.awnNumber) {
            element.awnNumber = '--';
        }
        if (!element.type) {
            element.type = '--';
        }
    });
    if (stDate) {
        details.startDate = await extractDate(stDate);
    }
    if (enDate) {
        details.endDate = await extractDate(enDate);
    } else { details.endDate = null; }

    var awnDetailsTableTemplate = new ACData.Template(awnDetailsTableJSON);
    var awnDetailsTable = awnDetailsTableTemplate.expand({
        $root: {
            properties: {
                active: details.status === 'Active' ? 'Active' : null,
                pending: details.status === 'Pending' ? 'Pending' : null,
                terminated: details.status === 'Terminated' ? 'Terminated' : null,
                statusReason: details.statusReason,
                date: details.startDate + '' + (details.endDate ? '-' + details.endDate : ''),
                awnDetails: details.awnDetails
            }
        }
    });
    return awnDetailsTable;
}

async function getHierarchyDetailsTable(details, agentId) {
    const { hierarchyList } = details;
    const { contractId, hierarchy } = hierarchyList[0];
    const { toh, immediateUpline, downlineCount } = hierarchy;
    const tohName = toh.name;
    const tohId = toh.agentId;
    const downlineCountId = agentId;

    const immediateUplineName = immediateUpline.name;
    const immediateUplineId = immediateUpline.agentId;
    const awnTohText = toh.awnNumber ? `(${toh.awnNumber})` : '';
    const awnImmediateUplineText = immediateUpline.awnNumber ? `(${immediateUpline.awnNumber})` : '';

    const tohUrl = `/agents/${tohId}/contracts/details/${toh.contractId}`;
    const immediateUplineUrl = `/agents/${immediateUplineId}/contracts/details/${immediateUpline.contractId}`;
    const downlineCountUrl = `agents/${downlineCountId}/contracts/details/${contractId}`;

    var hierarchyDetailsTableTemplate = new ACData.Template(hierarchyDetailsTableJSON);

    var hierarchyDetailsTable = hierarchyDetailsTableTemplate.expand({
        $root: {
            properties: {
                toh: tohName,
                tohId: tohId,
                immediateUpline: immediateUplineName,
                immediateUplineId: immediateUplineId,
                downlineCount: '' + downlineCount,
                awnTohText: awnTohText,
                awnImmediateUplineText: awnImmediateUplineText,
                tohUrl: tohUrl,
                immediateUplineUrl: immediateUplineUrl,
                downlineCountUrl: downlineCountUrl
            }
        }
    });
    return hierarchyDetailsTable;
}

async function getProductCertificationDetailsTable(details) {

    for (const [i, ele] of details.entries()) {
        ele.certificationDate = moment(ele.certificationDate).format('MM/DD/YYYY');
        ele.year = ele.year + '';
    }

    let productCertificationDetailsTableTemplate = new ACData.Template(productCertificationJSON);

    let productCertification = productCertificationDetailsTableTemplate.expand({
        $root: {
            properties: {
                productCertificationData: details
            }
        }
    });
    return productCertification;
}

async function getCarrierCertificationDetailsTable(details) {

    for (const [i, ele] of details.entries()) {
        ele.certificationDate = moment(ele.certificationDate).format('MM/DD/YYYY');
        ele.year = ele.year + '';
    }

    console.log("formatted details obj", details)

    let carrierCertificationDetailsTableTemplate = new ACData.Template(carrierCertificationJSON);

    let carrierCertification = carrierCertificationDetailsTableTemplate.expand({
        $root: {
            properties: {
                carrierCertificationData: details
            }
        }
    });
    return carrierCertification;
}

async function getContactInfoDetailsTable(details) {
    let contactInfoDetailsTableTemplate = new ACData.Template(contactInfoJSON);
    let isCommission = false;
    let isDefault = false;
    let isHome = false;
    let header = 'Email';

    details.forEach(val => {
        if (val.contactType === 'Phone Number') {
            val.contactValue = formatPhoneNumber(val.contactValue);
            header = 'Phone Number';
        }
        if (val.isHome) {
            isHome = true;
        }
        if (val.isDefault) {
            isDefault = true;
        }
        if (val.isCommission) {
            isCommission = true;
        }
    });

    let contactInfo = contactInfoDetailsTableTemplate.expand({
        $root: {
            properties: {
                contactInfoData: details,
                isCommission,
                isDefault,
                isHome,
                header
            }
        }
    });

    return contactInfo;
}

async function getAddressDetailsTable(details) {
    let addressDetailsTableTemplate = new ACData.Template(addressJSON);
    let isCommission = false;
    let isDefault = false;
    let isHome = false;

    details.forEach(val => {
        if (val.isHome) {
            isHome = true;
        }
        if (val.isDefault) {
            isDefault = true;
        }
        if (val.isCommission) {
            isCommission = true;
        }
    });

    let address = addressDetailsTableTemplate.expand({
        $root: {
            properties: {
                addressData: details,
                isCommission,
                isDefault,
                isHome
            }
        }
    });

    return address;
}

async function getpolicyLookupStatusDetailsTable(details) {


    const issuedDate = moment(details[0].issuedDate).format('MM/DD/YYYY');

    let policyLookupStatusDetailsTableTemplate = new ACData.Template(policyLookupStatusJSON);

    let policyLookupStatus = policyLookupStatusDetailsTableTemplate.expand({
        $root: {
            properties: {
                status: details[0].status,
                issuedDate: issuedDate,
                carrier: details[0].carrier,
                product: details[0].product,
                insured: details[0].insured
            }
        }
    });
    return policyLookupStatus;
}

async function getAgentGeolocationDetailsTable(details, agentGeoLocObj) {
    const distance = !!agentGeoLocObj.distance ? agentGeoLocObj.distance : 0;
    let carrier = encodeURIComponent(agentGeoLocObj.carrierName.trim());
    let url = `/agents/zipcode=${agentGeoLocObj.zipCode}/${carrier}/${distance}`;

    let agentGeolocationDetailsTableTemplate = new ACData.Template(agentGeolocationJSON);

    let agentGeolocation = agentGeolocationDetailsTableTemplate.expand({
        $root: {
            properties: {
                url: url,
                agentGeolocationData: details
            }
        }
    });
    return agentGeolocation;
}

async function getPolicyCommissionDetailsTable(details) {
    const policyCommissionDetails = new ACData.Template(policyCommissionTableJSON);
    const { totalCommission, commissionDetails, onlyCurrentYear } = details;

    commissionDetails.forEach(element => {
        if (onlyCurrentYear) {
            element.date = element.month ? element.month.toString() : "";
        } else {
            element.date = element.date ? element.date.toString() : "";
        }
        element.commission = element.commission.toString();
    });

    const policyCommissionTable = policyCommissionDetails.expand({
        $root: {
            properties: {
                totalCommission,
                commissionDetails
            }
        }
    });

    return policyCommissionTable;
}

async function extractDate(date) {
    return moment(date).format('MM/DD/YYYY');
}

const formatPhoneNumber = phoneNumber => {
    const cleaned = ('' + phoneNumber).replace(/D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
        return `(${match[1]}) ${match[2]}-${match[3]}`;
        // return '(' + match[1] + ') ' + match[2] + '-' + match[3];
    }
    return phoneNumber;
}

async function getCommissionDetailsTable(details) {
    var commissionDetailsTableTemplate = new ACData.Template(commissionDetailsTableJSON);
    for (const value in details) {
        details[value].commissionAmount = details[value].commissionAmount >= 0 ? '$' + (Number.parseFloat(details[value].commissionAmount).toFixed(2)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-$' + (Math.abs(Number.parseFloat(details[value].commissionAmount).toFixed(2))).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    var commissionDetailsTable = commissionDetailsTableTemplate.expand({
        $root: {
            properties: details
        }
    });
    return commissionDetailsTable;
}

async function getStatusCard(details) {
    var statusCardTemplate = new ACData.Template(statusCardJSON);
    if (details.startDate) {
        details.startDate = await extractDate(details.startDate);
    }

    var statusCard = statusCardTemplate.expand({
        $root: {
            properties: {
                active: details.status === 'Active' ? 'Active' : null,
                pending: details.status === 'Pending' ? 'Pending' : null,
                terminated: details.status === 'Terminated' ? 'Terminated' : null,
                status: details.status,
                statusReason: details.statusReason,
                startDate: details.startDate,
                contractId: details.contractId
            }
        }
    });
    return statusCard;
}

async function getOnlyAWNCard(details) {
    await details.awnDetails.forEach(async (element) => {
        if (!element.awnNumber) {
            element.awnNumber = '--';
        }
    });

    var onlyAWNTableTemplate = new ACData.Template(onlyAWNJSON);
    var onlyAWNTable = onlyAWNTableTemplate.expand({
        $root: {
            properties: {
                awnDetails: details.awnDetails
            }
        }
    });
    return onlyAWNTable;
}

async function adaptiveCard(adaptiveCard, isCarousel) {
    let card = null; let send = null;
    if (!isCarousel) {
        card = CardFactory.adaptiveCard(adaptiveCard);
        send = MessageFactory.attachment(card);
    } else {
        const attach = [];
        adaptiveCard.forEach((element) => {
            card = CardFactory.adaptiveCard(element);
            attach.push(card);
        });
        send = MessageFactory.carousel(attach);
    }
    return send;
}

module.exports = {
    getButtonsCard,
    getTipAdaptiveCard,
    getAgentInfoCard,
    getAgentCommissionCard,
    getCommissionDetailsTable,
    getProductLevelTable,
    getAwnDetailsTable,
    adaptiveCard,
    getnoThanksCard,
    getStatusCard,
    getOnlyAWNCard,
    getHierarchyDetailsTable,
    getProductCertificationDetailsTable,
    getCarrierCertificationDetailsTable,
    getContactInfoDetailsTable,
    getAddressDetailsTable,
    getAgentGeolocationDetailsTable,
    getpolicyLookupStatusDetailsTable,
    getPolicyCommissionDetailsTable
};
