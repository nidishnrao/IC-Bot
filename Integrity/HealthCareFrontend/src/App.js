import React from 'react';

import WebChatUI from './components/WebChat/index';
import WebPageBackground from './assets/images/WebPage.jpg';
import './App.css';

const App = () => {
  const token = new URL(window.location.href).searchParams.get('token')
  const name = new URL(window.location.href).searchParams.get('name')
  let config = {
    botConfig: require(`./components/WebChat/bot-config.json`),
    marketerName: name ? name : 'John Snuffy',
    marketerId: 's1234567890',
    // authorization: 'Bearer ' + token,
    host: 'local',
    // hostUrl: 'http://localhost:3000/'
    authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImZfNjh1U2lDSUtsYngzaGx0ZHR6YiJ9.eyJodHRwOi8vY2xhaW1zLmV4YW1wbGUuY29tL2VtYWlsIjoiTmlkaXNoLk5SYW9AaW50ZWdyaXR5bWFya2V0aW5nLmNvbSIsImh0dHA6Ly9jbGFpbXMuZXhhbXBsZS5jb20vdXNlcm5hbWUiOiJOaWRpc2ggTi4gUmFvIiwiaXNzIjoiaHR0cHM6Ly9kZXYtemFleGd4ZmYudXMuYXV0aDAuY29tLyIsInN1YiI6IndhYWR8VHpsVnVVVDFicTU2OVp5UG1zdHVXYk8tdXZ6RUZZeGN5MC1uTFdPLTk5NCIsImF1ZCI6WyJodHRwczovL1NlcnZpY2VBdXRoLmNvbSIsImh0dHBzOi8vZGV2LXphZXhneGZmLnVzLmF1dGgwLmNvbS91c2VyaW5mbyJdLCJpYXQiOjE2ODk3MDMwMzMsImV4cCI6MTY4OTgyMzAzMywiYXpwIjoid3RrZVhsQXdCZDFyMXVtOWlKU0pUUHplZllLS3VqTFYiLCJzY29wZSI6Im9wZW5pZCBwcm9maWxlIGVtYWlsIG9mZmxpbmVfYWNjZXNzIn0.nD9oQNsMV8AiBvYzB6evO8PFH7ntyO3n2iSi8ePJI5cUnvsP3AuvW46Xd-UsozdOc74vryGvHc6V7chyzN73XNAfkCdO_bDwr7IjUoC66cQd7YCc7aKoUWeUgj1bxQqWIMLmtRtTBH81c6r4qiHdqhbGh84MxD8XX8VqeKtUFGGx9VOmjN42upw_vtPvd8anVbXpvTy8q61_UxSQyJLbfh1EbQ5y92UEJ5y7AEl9jXdWJRi1Comj53GEOx2FhxxEsJxZoXhQIpNKtbmrRIfzMDjHR5xhYfPaLtMwa3UxDKJmKgjnBvf0jxcMMYCwze7nimu6VI_kTq66QsGp8KQuBA',
    hostUrl: 'https://ams-pre-dev.integritymarketing.com/'
  }
  return (
    <div className="App">
      <img alt="product background" src = {WebPageBackground} />
      <WebChatUI data = {config}/>
    </div>
  );
}

export default App;
