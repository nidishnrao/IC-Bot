import React, { useEffect, useMemo } from 'react';
import ReactWebChat, { createDirectLine } from 'botframework-webchat';

import '../css/WebChat.css';
import botIcon from '../../assets/images/bot-large.png';

const WebChat = ({ className, onFetchToken, token, store, styleSet, styleOptions}) =>  {
  const directLine = useMemo(() => createDirectLine({ token }), [token]);

  useEffect(() => {
    onFetchToken();
  }, [onFetchToken]);

  return (token) ? (
     <ReactWebChat className={`${className || ''} web-chat`}
      directLine={directLine}
      store={store} 
      styleSet={styleSet} 
      styleOptions={styleOptions}
      sendTypingIndicator={true}
    />
  ) : (
     <div className={`${className || ''} connect-spinner`}>
      <div className="content">
        <div className="icon">
          <img src={botIcon} alt="bot Icon" className="initIcon"/>
        </div>
        <p class="initP">Please wait while we are connecting.</p>
      </div>
    </div>
  );
};

export default WebChat;
