const USER_PROFILE_PROPERTY = 'userProfile';

// This methods are used for global session management

async function putData(userState, context, key, value) {
    const userProfile = await createUserProfile(userState, context);
    userProfile[key] = value;
}

async function getData(userState, context, key) {
    // console.log('getData - userState: ',userState);
    const userProfile = await createUserProfile(userState, context);
    return userProfile[key];
}

async function clearData(userState, context, key) {
    const userProfile = await createUserProfile(userState, context);
    // userProfile[key] = undefined;
    await delete userProfile[key];
}

async function clearAllData(userState, context) {
    const userProfile = await createUserProfile(userState, context);
    for (const i in userProfile) {
        // userProfile[i] = undefined;
        await delete userProfile[i];
    }
}

async function createUserProfile(userState, context) {
    var userProfileAccessor = userState.createProperty(USER_PROFILE_PROPERTY);
    return await userProfileAccessor.get(context, {});
}

module.exports = {
    putData,
    getData,
    clearData,
    clearAllData
};
