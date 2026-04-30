// MV3 service worker — drains the offline scan queue on startup and on
// chrome.alarms tick (mitigates idle-timeout per R-04 in the risk register).
import { drainQueue } from './sync.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('drain-queue', { periodInMinutes: 5 });
});

chrome.runtime.onStartup.addListener(() => {
  void drainQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'drain-queue') void drainQueue();
});
