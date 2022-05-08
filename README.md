<p align="center"><br><img src="https://user-images.githubusercontent.com/236501/85893648-1c92e880-b7a8-11ea-926d-95355b8175c7.png" width="128" height="128" /></p>
<h3 align="center">App Updater</h3>
<p align="center"><strong><code>@objekt/capacitor-app-updater</code></strong></p>
<p align="center">
	Cross platform CapacitorJS plugin to update the web contents of an app from a remote content server.
</p>

<p align="center">
	<img src="https://img.shields.io/maintenance/yes/2022?style=flat-square" />
	<a href="https://github.com/capacitor-community/http/actions?query=workflow%3A%22Test+and+Build+Plugin%22"><img src="https://img.shields.io/github/workflow/status/capacitor-community/http/Test%20and%20Build%20Plugin?style=flat-square" /></a>
	<a href="https://www.npmjs.com/package/@objekt/capacitor-app-updater"><img src="https://img.shields.io/npm/l/@objekt/capacitor-app-updater?style=flat-square" /></a>
	<br>
	<a href="https://www.npmjs.com/package/@objekt/capacitor-app-updater"><img src="https://img.shields.io/npm/dw/@objekt/capacitor-app-updater?style=flat-square" /></a>
	<a href="https://www.npmjs.com/package/@objekt/capacitor-app-updater"><img src="https://img.shields.io/npm/v/@objekt/capacitor-app-updater?style=flat-square" /></a>
	<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
	<a href="#contributors-"><img src="https://img.shields.io/badge/all%20contributors-1-orange?style=flat-square" /></a>
	<!-- ALL-CONTRIBUTORS-BADGE:END -->
</p>

## Introduction
Cross platform CapacitorJS plugin to update the web contents of an app from a remote content server.

### How it works
The plugin exposes a single ```AppUpdater.sync(checksumURL, checkDelay=1000*60*60)``` function that takes a URL to a ```checksum.json``` file of your hosted web app bundle.

When called, the plugin performs the following steps:
1. Check that the sync process has not already been run recently within a specified time delay.
2. Load the specified checksum URL
3. Compares the checksum of the files in the local web content directory with the checksums provided in the ```checksum.json``` file.
4. If nothing has changed, then terminate the job.
5. If any checkums differ, then create a new bundle on the device.
6. Download all files with differing checksums fresh from the web server.
7. Copy all files with the same checksum over from the local web content directory.
8. Ensure all file have downloaded successfully.
9. Modify the local the Capacitor app config to point to the new release bundle.
10. Reload the app

### Check Delay

As the sync task may delay your app startup time, you may not want to run it everytime the user launches your app. Instead you can specify an optional check delay time in milliseconds as second argument to the ```sync``` function to skip syncing if the job ran within the set delay time already. This defaults to 60 minutes.

### Running on Web vs Native

Running ```sync``` on non-native environments such as the web is simply ignored. For the web version of your Capaitor app a service worker should instead be used to cache your web app files locally. See [Workbox](https://developer.chrome.com/docs/workbox/).

## Installation
```bash
npm install @objekt/capacitor-app-updater
```

## Configuration
This plugin will work without any configuration all Android and iOS.
## Usage

### Step 1 - Basic Implementation (index.js)

Place the following snippet in the root of your capacitor web app, e.g. your index.js file.

```js
import { AppUpdater } from '@objekt/capacitor-app-updater';

import { SplashScreen } from '@capacitor/splash-screen';

(async () => {

	// Check for app updates.
	const didUpdate = await AppUpdater.sync("https://your-web-server-url/checksum.json", 1000*60*60); // Only check once every 60 minutes.

	// Stop processing if there was an update, as the updated would have triggered a page reload.
	if (didUpdate) {
		return;
	}

	// Load the app shell.
	await import('./modules/AppShell.js');

	// Hide the native splash screen.
	await SplashScreen.hide();

})();
```
### Step 2 - Build your web application

Follow your normal build process (e.g. webpack, rollup, etc.) to generate a distribution bundle of your app that contains all of the HTML, CSS, JS, and assets that you would publish to your app content server.

### Step 3 - Create a checksum file for the build

Create a ```checksum.json``` file in the build folder that contains a checksum for the build overall as well as each individual file in the build.
```json
{
	"id":"9d307fdcafb3f6f2fbcd47899df78652936cea00",
	"timestamp":"2022-04-10T15:21:08.406Z",
	"files":[
		{
			"path":"index.html",
			"hash":"064c47308009992f133a44e368cf1dcfdaa9d85e"
		},
		{
			"path":"app.39b812d9.js",
			"hash":"1bd6e3344fbc3363b1faa00d1115378135aac5ce"
		},
		{
			"path":"vendors.70682963.js",
			"hash":"5b055ca612c8e6883decd76258261d85da3de644"
		}
	]
}
```

## API Reference

TODO - implement DocGen

## Contributors ✨

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!

## LICENSE

[MIT](LICENSE)