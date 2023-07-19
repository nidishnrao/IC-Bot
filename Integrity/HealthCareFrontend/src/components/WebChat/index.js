import classNames from 'classnames';
import React, { useCallback, useMemo, useState } from 'react';
import { createStore, createStyleSet } from 'botframework-webchat';
import ReactRoundedImage from "react-rounded-image";

import WebChat from './assets/js/WebChat';
import helpIcon from './assets/images/help.png';
import exchangeIcon from './assets/images/exchange.png';
import './assets/css/fabric-icons-inline.css';
import './assets/css/MinimizableWebChat.css';
import launchIcon from './assets/images/launch.png';
import closeIcon from './assets/images/close.png';
import AgentCard from '../AgentCard';
import indicatorGif from './assets/images/indicator.gif';

const WebChatUI = (props) => {
  const [agent, setAgent] = useState(null);

  const botConfig = props.data.botConfig;
  const SERVER_URL = botConfig.SERVER_URL[props.data.host];
  
  const store = useMemo(
    () =>
      createStore({}, ({ dispatch }) => next => action => {
        if (action.type === 'WEB_CHAT/SET_SEND_BOX') {
          const user_entered_text = action.payload.text;
          // TODO: Handle 3 char validation for names
        }
        if (action.type === 'DIRECT_LINE/CONNECT_FULFILLED') {
          dispatch({
            type: 'WEB_CHAT/SEND_EVENT',
            payload: {
              name: 'webchat/join',
              value: {
                language: window.navigator.language,
                marketerName: props.data.marketerName,
                marketerId: props.data.marketerId,
                authorization: props.data.authorization,
                host: props.data.host,
                hostUrl: props.data.hostUrl
              }
            }
          });
        }
        else if(action.type === 'DIRECT_LINE/INCOMING_ACTIVITY'){
          if (action.payload.activity.from.role === 'bot') {
            setNewMessage(true);
          }
          if (action.payload.activity.name === 'displayAgent') {
            setAgent({
              agentId: action.payload.activity.value.agentId,
              agentName: action.payload.activity.value.agentName
            });
          }
          if (action.payload.activity.name === 'hideAgent') {
            setAgent(null);
          }
          if (action.payload.activity.name === 'hideSendBox' || 
              (action.payload.activity.attachments && 
                ((action.payload.activity.attachments[0].content.id === 'carrierCard') ||
                (action.payload.activity.attachments[0].content.id === 'commissionButtons') ||
                (action.payload.activity.attachments[0].content.id === 'dropDownCard') ||
                (action.payload.activity.attachments[0].content.id === 'statusInfoCard') ||
                (action.payload.activity.attachments[0].content.id === 'anotherCarrierConfirmButton') ||
                (action.payload.activity.attachments[0].content.id === 'dropDownNoThanksCard')))) {
            setBotStyleOptions(styleOptionsHideSendBox);
          } else {
            setBotStyleOptions(styleOptions);
          }
        } else if( action.type === 'DIRECT_LINE/POST_ACTIVITY'){ 
          if(action.payload.activity.type === 'message'){
            let message  = action.payload.activity.text ? action.payload.activity.text : action.payload.activity.value.dropDownInfo;
            console.log('Text: ', message);
            let data = [];
            if(message && message.startsWith('@#')){
              let extractedStr = message.match("@#(.*)#@");
              let stringArray = extractedStr[1].split("==");
              stringArray.forEach((element) => {
                let keyValue = element.split(":");
                let key = keyValue[0].trim();
                let value = keyValue[1].trim();
                data.push({[key] : value});
              });
              action.payload.activity.text = message.replace('@#' + extractedStr[1] + '#@', '');
              if(action.payload.activity.value && action.payload.activity.value.dropDownInfo){
                action.payload.activity.value.dropDownInfo = message.replace('@#' + extractedStr[1] + '#@', '');
              }
            }
            let channelData = action.payload.activity.channelData;
            if(channelData){
              channelData.authToken = props.data.authorization //await Utils.getApiKey(); // Change this during deployment
              channelData.data = data
              action.payload.activity.channelData = channelData;
            } else {
              action.payload.activity.channelData = { 
                authToken: props.data.authorization,//await Utils.getApiKey() // Change this during deployment
                data: data
              }; 
            }
            console.log('POST_ACTIVITY: ', action.payload.activity.channelData); 
          }
        } 
        return next(action);
      }),
    []
  );

  const styleSet = useMemo(
    () =>
      createStyleSet({
        backgroundColor: botConfig.BOT_CSS.CHAT_BACKGROUND_COLOR,
        bubbleBackground: botConfig.BOT_CSS.BUBBLE_BACKGROUND_COLOR,
        bubbleTextColor: botConfig.BOT_CSS.BUBBLE_TEXT_COLOR,
        bubbleFromUserBackground: botConfig.BOT_CSS.FROM_BUBBLE_BACKGROUND_COLOR,
        bubbleFromUserTextColor: botConfig.BOT_CSS.FROM_BUBBLE_TEXT_COLOR,
        bubbleBorderRadius: 5,
        bubbleFromUserBorderRadius: 5,
        typingAnimationBackgroundImage: `url('${indicatorGif}')`,
      }),
    []
  );

  const botImage = botConfig.APP_IMAGE;

  const styleOptions = {
    botAvatarImage: botConfig.BOT_IMAGE,
    botAvatarInitials: 'BF',
    emojiSet: true,
    hideUploadButton:true,
    userAvatarImage: botConfig.USER_IMAGE,
    userAvatarInitials: 'UI'
  }

  const styleOptionsHideSendBox = {
    hideSendBox: true,
    botAvatarImage: botConfig.BOT_IMAGE,
    botAvatarInitials: 'BF',
    emojiSet: true,
    hideUploadButton:true,
    userAvatarImage: botConfig.USER_IMAGE,
    userAvatarInitials: 'UI'
  }

  const [botStyleOptions, setBotStyleOptions] = useState(styleOptions);
  const [loaded, setLoaded] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [newMessage, setNewMessage] = useState(false);
  const [token, setToken] = useState();

  const handleFetchToken = useCallback(async () => {
    var params = JSON.stringify({
      marketerId: props.data.marketerId
    });

    if (!token) {
      const res = await fetch(SERVER_URL+'/directline/token', { method: 'POST', body: params });
      const { token } = await res.json();
      setToken(token);
    }
  }, [setToken, token]);

  const handleMaximizeButtonClick = useCallback(async () => {
    setLoaded(true);
    setMinimized(false);
    setNewMessage(false);
  }, [setMinimized, setNewMessage]);

  const handleMinimizeButtonClick = useCallback(() => {
    setMinimized(true);
    setNewMessage(false);
  }, [setMinimized, setNewMessage]);

  const ImageStyle = {
    position: 'absolute', left: '50%', top: '50%',
    transform: 'translate(-50%, -50%)'
  }

  const handleSendMessageToBot = (message) => {
    store.dispatch({
      type: 'WEB_CHAT/SEND_MESSAGE',
      payload:{
        text: message+' is selected!'
      }
    });
  }

  return (
    <div className="minimizable-web-chat">
      {minimized && (
        <button className="maximize" onClick={handleMaximizeButtonClick}>
          <img id="bot" src={launchIcon} alt="Launch Icon"/>
          {newMessage && <span className="ms-Icon ms-Icon--CircleShapeSolid red-dot" />}
        </button>
      )}
      {loaded && (
        <div className={classNames('chat-box right', minimized ? 'hide' : '')}
         style={{
           borderTopColor: botConfig.BOT_CSS.BOT_HEADER_BACKGROUND, 
           borderBottomColor: botConfig.BOT_CSS.CHAT_BACKGROUND_COLOR,
           borderLeft:'0px',
           borderRight:'0px',
           borderTopLeftRadius:'10px',
           borderTopRightRadius:'10px',
           borderBottomLeftRadius:'5px',
           borderBottomRightRadius:'5px'}}>
          <header 
          style={{
            background: botConfig.BOT_CSS.BOT_HEADER_BACKGROUND, 
            borderTopLeftRadius:'5px',
            borderTopRightRadius:'5px'}}>
            <div style={{ marginLeft: '10px', marginTop:'5px'}}>
              <ReactRoundedImage
                image={botImage}
                roundedColor={ botConfig.BOT_CSS.BOT_HEADER_BACKGROUND}
                imageWidth="40"
                imageHeight="25"
                style={ImageStyle}
                roundedSize="3"
                borderRadius="90"
              />
            </div>
            <h4
              style={{
                color:'white',
                paddingLeft:5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop:14, 
                marginLeft:5
              }}
            >
              { botConfig.APP_NAME }
            </h4 >
            <div className="filler" />
          </header>
          <WebChat
            className="react-web-chat"
            onFetchToken={handleFetchToken}
            token={token}
            store={store}
            styleSet={styleSet}
            styleOptions={botStyleOptions}
            />
          {token && (
            <div className="chatBottom">
             { agent && <AgentCard handleSendMessageToBot={handleSendMessageToBot} agent={agent}/> }
              <div className="bottomIcons">
                <img class="bottomIconData" id="resetIcon" src={exchangeIcon} alt="reset" onClick={(e) => handleSendMessageToBot('Start Over')}/>
                <div class="bottomIconData" onClick={(e) => handleSendMessageToBot('Start Over')}>Start Over</div>
                <span class="bottomdivider"></span>
                <img class="bottomIconData" id="helpIcon" src={helpIcon} alt="help" onClick={(e) => handleSendMessageToBot('Help')}/>
              </div>
            </div>
          )}
        </div>
      )}
      {!minimized && (
        <button className="minimize"><img id="close" src={closeIcon} alt="close" onClick={handleMinimizeButtonClick}/></button>
      )}
    </div>
  );
};

export default WebChatUI;
