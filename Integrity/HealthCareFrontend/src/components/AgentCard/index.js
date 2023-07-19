import { Fragment, Component } from 'react';
import ReactDOM from 'react-dom';

import './assets/css/AgentCard.css';
import menuIcon from './assets/images/menu.png';
import agentIcon from './assets/images/agent.png';
import menuCloseIcon from './assets/images/menu-close.png';
import shuffleIcon from './assets/images/shuffle.png';

class AgentCard extends Component {
    constructor(props) {
        super(props);
        this.state = {
            updateMenuComponent: false
        };
        this.updateMenuComponent = this.updateMenuComponent.bind(this);
    }    

    updateMenuComponent = () => {
        this.setState(prev => ({
            updateMenuComponent: !prev.updateMenuComponent
        }));
    };
  
    render(){
        let menuIconImg = (<img src={menuCloseIcon} alt="menuClicked" onClick={this.updateMenuComponent} />);
        if (!this.state.updateMenuComponent){
            menuIconImg = (<img src={menuIcon} alt="menu" onClick={this.updateMenuComponent} />);
        }
        return (
            <Fragment>   
                <div className={ this.state.updateMenuComponent ? "menuBox" : "menuCollapse"}>
                  <div className="menuAgentBox">
                   
                    <div className='menuImage'>
                        {menuIconImg}
                    </div>
                    <div className='agent'>
                        <img className="image" src={agentIcon} alt="user"/>
                       Selected Patient:
                        <p>{this.props.agent.agentName} | {this.props.agent.agentId}</p>
                    </div>
                    <div className='changeAgent' onClick={(e) => this.props.handleSendMessageToBot('Change Patient')}>
                        <img src={shuffleIcon} alt="changeAgent"/>
                        <a>Change Patient</a>
                    </div>
                    </div>
                    {this.state.updateMenuComponent && 
                        <div className="agentMenu">
                            <div className="agentMenuOptions">
                                <button onClick={(e) => this.props.handleSendMessageToBot('Labs Info')}>Labs Info</button>
                                <button onClick={(e) => this.props.handleSendMessageToBot('EMR Info')}>EMR Info</button>
                                <button disabled onClick={(e) => this.props.handleSendMessageToBot('Rx')}>Rx</button>
                                <button disabled onClick={(e) => this.props.handleSendMessageToBot('Appointments')}>Appointments</button>
                                <button disabled onClick={(e) => this.props.handleSendMessageToBot('Insurance status')}>Insurance status</button>
                            </div>
                            <div className="smallText">Choosing a menu will close the current conversation.</div>
                        </div>
                    }
                </div>   
            </Fragment>
        )
    }
}

export default AgentCard;