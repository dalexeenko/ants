// Expo entry point
// IMPORTANT: Polyfills must be imported first, before any other code
import './src/polyfills';

import { registerRootComponent } from 'expo';
import { App } from './src/App';

registerRootComponent(App);
