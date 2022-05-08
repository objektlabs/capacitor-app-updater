import { Capacitor, WebView } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

import { Http } from '@capacitor-community/http';

/**
 * The checksum of a single file.
 *
 * @typedef {object} ChecksumFile
 *
 * @property {string} path - The relative path to the file in the checksum package.
 * @property {string} hash - The unique file hash based on it's contents.
 */

/**
 * The checksum of a package of files.
 *
 * @typedef {object} Checksum
 * 
 * @property {string} id - The unique identifier of the checksum.
 * @property {Date} timestamp - The date the checksum was generated.
 * @property {ChecksumFile[]} files - The package of files.
 */

/**
 * CapacitorJS plugin to update the web contents of an app from a remote content server.
 * 
 * @example
 * ```js
 * import { AppUpdater } from '@objekt/capacitor-app-updater';
 * 
 * // Check for app updates on the remote content server.
 * const didUpdate = await AppUpdater.sync("https://your-web-server-url", 1000*60*60); // Only check once every 60 minutes.
 * 
 * // Stop processing if there was an update, as the updated would have triggered a page reload.
 * if (didUpdate) {
 * 	return;
 * }
 * 
 * // Load the app shell.
 * // ... e.g. await import('./src/AppShell.js');
 * 
 * ```
 */
export class AppUpdater {

	/**
	 * Syncs the online web app to the native app shell.
	 * 
	 * Note: this function triggers a browser reload if the app was updated successfully to point to the new release.
	 *  
	 * @param {string} webServerURL - The URL of the online web server.
	 * @param {number} [checkDelay=3600000] - The amount of time to allow between update checks. Defaults to 60 minutes.
	 * 
	 * @returns {boolean} True, if the app was updated, otherwise false.
	 */
	static async sync(webServerURL, checkDelay = 1000 * 60 * 60) {

		// Do not run the sync job on non-native platforms. On Web the service worker will manage caching file instead.
		if (!Capacitor.isNativePlatform()) {
			return false;
		}

		// Start the app update job.
		const timeStart = new Date();

		console.log('AppUpdater: Starting...');

		try {

			// Get the currently installed release version.
			let activeRelease = await getCurrentRelease();

			// Build the initial release from the app bundle if no release has been installed.
			if (!activeRelease) {
				activeRelease = await buildReleaseFromBundle();
			}

			// Check that enough time has elapsed before we can check for an update again.
			const lastUpdated = activeRelease.updated;
			const nextUpdateDue = new Date(lastUpdated.getTime() + checkDelay);

			if (new Date() < nextUpdateDue) {
				throw `Last update was run at '${lastUpdated.toJSON()}'. Next update check only due at '${nextUpdateDue.toJSON()}'`;
			}

			// Go online to check what the latest app release is.
			const checksum = await getServerChecksum(webServerURL + '/checksum.json');

			if (!checksum) {
				throw 'Unable to get checksum from server';
			}

			// Check that latest release is not already installed.
			if (activeRelease.checksum.id === checksum.id) {

				// Nothing changed, reset the update check timestamp so that we don't check again unnesasarily.
				setCurrentRelease(checksum.id, new Date());

				throw `Latest release already installed (${checksum.id})`;
			}

			// Prepare to download a new release.
			await createDir('releases', Directory.Data);
			await removeDir('releases/next', Directory.Data);

			// Create the empty directory structure for each of the files in the new release package.
			let paths = [...new Set(checksum.files.map(file => file.path.substring(0, file.path.lastIndexOf('/'))))];

			for (const path of paths) {
				await createDir(`releases/next/${path}`, Directory.Data);
			}

			// Download the new release files from the web server.
			let downloadTasks = [];

			for (const file of checksum.files) {

				if (activeRelease.checksum.files.find(item => item.path === file.path && item.hash === file.hash)) {

					// Copy the file from the previous release if an exact checksum hash match exists for the server file.
					downloadTasks.push(copyFromPreviousRelease(
						`releases/${activeRelease.checksum.id}/${file.path}`,
						`releases/next/${file.path}`,
						Directory.Data
					));

				} else {

					// Otherwise just download the file fresh from the web server.
					downloadTasks.push(downloadFileFromWebServer(
						`${webServerURL}/${file.path}`,
						`releases/next/${file.path}`,
						Directory.Data
					));
				}
			}

			await Promise.all(downloadTasks);

			// Save the release checksum.
			await Filesystem.writeFile({
				path: 'releases/next/checksum.json',
				directory: Directory.Data,
				data: JSON.stringify(checksum),
				encoding: Encoding.UTF8,
				recursive: true
			});

			// Install the downloaded release package.
			await Filesystem.rename({
				from: 'releases/next',
				to: `releases/${checksum.id}`,
				directory: Directory.Data
			});

			// Delete any old release packages.
			await deleteOldReleases(checksum.id);

			// Activate the downloaded release.
			await activateRelease(checksum.id);

			// Report that the app was succefully updated.
			return true;

		} catch (error) {

			console.log('AppUpdater: Staying on current version.\n\n', error);

			// Report that the app did not update.
			return false;

		} finally {

			console.log(`AppUpdater: Done in '${(new Date().getTime() - timeStart.getTime())}' milliseconds...`);
		}
	}
}

// --------------
// STEP FUNCTIONS
// --------------

/**
 * Get meta data for the currently installed app release.
 * 
 * @private
 * 
 * @returns {object} The installed release details.
 */
async function getCurrentRelease() {

	console.debug('AppUpdater: Looking for current release.');

	try {

		const result = await Filesystem.readFile({
			path: 'version.json',
			directory: Directory.Data,
			encoding: Encoding.UTF8
		});

		if (result.data) {

			// Get the active release summary details.
			const data = JSON.parse(result.data);

			// Get the checksum for the active release.
			const checksum = JSON.parse((await Filesystem.readFile({
				path: `releases/${data.id}/checksum.json`,
				directory: Directory.Data,
				encoding: Encoding.UTF8
			})).data);

			// Return the release version details.
			console.debug(`AppUpdater: Found release version '${data.id}'`);

			return {
				id: data.id,
				updated: new Date(data.updated),
				checksum: checksum
			};
		}

	} catch (ignore) {
		console.debug('AppUpdater: Could not find "version.json", must be a new app install.');
	}

	return null;
}

/**
 * Builds an initial release from the bundled app content.
 * 
 * @private
 * 
 * @throws If the release could not be built from the app bundle.
 * 
 * @returns {object} The built release details.
 */
async function buildReleaseFromBundle() {

	console.debug('AppUpdater: Building initial release from app bundle.');

	try {

		// Get the bundled release checksum.
		const response = await fetch('http://localhost/checksum.json');
		const checksum = await response.json();

		// Prepare to download a new release.
		await createDir('releases', Directory.Data);

		// Create the empty directory structure for each of the files in the new release package.
		let paths = [...new Set(checksum.files.map(file => file.path.substring(0, file.path.lastIndexOf('/'))))];

		for (const path of paths) {
			await createDir(`releases/${checksum.id}/${path}`, Directory.Data);
		}

		// Download the release files from the app bundle local web server.
		let downloadTasks = [];

		for (const file of checksum.files) {

			downloadTasks.push(downloadFileFromAppBundle(
				`http://localhost/${file.path}`,
				`releases/${checksum.id}/${file.path}`,
				Directory.Data
			));
		}

		await Promise.all(downloadTasks);

		// Save the release checksum.
		await Filesystem.writeFile({
			path: `releases/${checksum.id}/checksum.json`,
			directory: Directory.Data,
			data: JSON.stringify(checksum),
			encoding: Encoding.UTF8,
			recursive: true
		});

		// Saves app release summary file.
		const releaseID = checksum.id;
		const releaseDate = new Date(checksum.timestamp);

		await setCurrentRelease(releaseID, releaseDate);

		// Return the release version details.
		return {
			id: releaseID,
			updated: releaseDate,
			checksum: checksum
		};

	} catch (error) {

		console.error(error);

		// Clean-up the job output when things go wrong.
		await removeDir('releases', Directory.Data);

		// Throw the error to break the update process.
		throw 'AppUpdater: Could not build release from bundled.';
	}
}

/**
 * Set the meta data for the currently installed app release.
 * 
 * @private
 * 
 * @param {string} releaseName - The name to the new release.
 * @param {Date} timestamp - The timestamp on which the app was updated.
 * 
 * @returns {void}
 */
async function setCurrentRelease(releaseName, timestamp = new Date()) {

	console.debug(`AppUpdater: App configured for release '${releaseName}'.`);

	// Update app release summary file.
	await Filesystem.writeFile({
		path: 'version.json',
		data: JSON.stringify({
			id: releaseName,
			updated: timestamp
		}),
		directory: Directory.Data,
		encoding: Encoding.UTF8,
		recursive: true
	});
}

/**
 * Deletes all old release directories from the app container.
 * 
 * @private
 * 
 * @param {string} activeReleaseName - The active release not to delete.
 * 
 * @returns {void}
 */
async function deleteOldReleases(activeReleaseName) {

	console.debug('AppUpdater: Deleting old releases.');

	// Get a list of all the release directories.
	let installedReleases = (await Filesystem.readdir({
		path: 'releases',
		directory: Directory.Data
	})).files;

	// Delete all the directories except for the active release.
	if (installedReleases.length > 0) {

		for (let oldReleaseName of installedReleases) {

			if (oldReleaseName !== activeReleaseName) {

				await Filesystem.rmdir({
					path: `releases/${oldReleaseName}`,
					directory: Directory.Data,
					recursive: true
				});
			}
		}
	}
}

/**
 * Activates a downloaded app release package.
 * 
 * @private
 * 
 * @param {string} releaseName - The name to the new release.
 * 
 * @returns {void}
 */
async function activateRelease(releaseName) {

	console.debug(`AppUpdater: Reloading app to release '${releaseName}'.`);

	// Get the URI path to the app release directory.
	const releasePath = await Filesystem.getUri({
		path: `releases/${releaseName}`,
		directory: Directory.Data
	});

	// Saves app release summary file.
	await setCurrentRelease(releaseName, new Date());

	// Point the app web view to the new release folder.
	if (Capacitor.getPlatform() === 'android') {
		await WebView.setServerBasePath({ path: releasePath.uri.replace('file://', '') });
	} else {
		await WebView.setServerBasePath({ path: releasePath.uri.replace('file://', '') }); // TODO - test if ios works the same as android, this line might have to change to their file storage convention.
	}

	// Ensure the new base path persists across sessions.
	await WebView.persistServerBasePath();
}

// ----------------
// HELPER FUNCTIONS
// ----------------

/**
 * Downloads a checksum for a given web app.
 * 
 * @private
 * 
 * @param {string} url - The url to the web app.
 * 
 * @returns {Promise<Checksum>} The web app checksum data.
 */
async function getServerChecksum(url) {

	console.debug(`AppUpdater: Getting latest release checksum from '${url}'`);

	try {

		return (await Http.request({
			url: url,
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})).data;

	} catch (error) {

		console.debug('AppUpdater: Could not download and parse server checksum.\n\n', error);
	}

	return null;
}

/**
 * Copies a file from a previous release to a new release.
 * 
 * @private
 * 
 * @param {string} fromPath - The path of the file to copy.
 * @param {string} toPath - The path to copy the file to.
 * @param {Directory} directory - The base directory to work in.
 * 
 * @async
 * 
 * @returns {void}
 */
async function copyFromPreviousRelease(fromPath, toPath, directory) {

	console.debug(`AppUpdater: Copy from previous release: '${fromPath}'`);

	await Filesystem.copy({
		from: fromPath,
		to: toPath,
		directory: directory
	});
}

/**
 * Downloads a file from the app web server to a given directory.
 * 
 * @private
 * 
 * @param {string} url - The URL of the file to download.
 * @param {string} path - The path to save the file to.
 * @param {Directory} directory - The base directory to work in.
 * 
 * @async
 * 
 * @returns {void}
 */
async function downloadFileFromWebServer(url, path, directory) {

	console.debug(`AppUpdater: Download from Server: '${path}'`);

	return Http.downloadFile({
		url: url,
		method: 'GET',
		filePath: path,
		fileDirectory: directory,
		connectTimeout: 10 * 1000,
		readTimeout: 10 * 1000
	});
}

/**
 * Downloads a file from app bundle (localhost) to a given directory.
 * 
 * @private
 * 
 * @param {string} url - The URL of the file to download.
 * @param {string} path - The path to save the file to.
 * @param {Directory} directory - The base directory to work in.
 * 
 * @returns {boolean} True if the file cold be downloaded, otherwise false.
 */
async function downloadFileFromAppBundle(url, path, directory) {

	console.debug(`AppUpdater: Download from Bundle: '${path}'`);

	/*
		This is a complex issue to solve without writing native code. But the below workaround works perfectly well
		for copying small files from the bundled app content to another folder on disk.

		A couple of things to note:

		  1) The web assets that is bundled with the native app when it is packaged gets hosted by Capacitor locally
			 on a webserver in app the runs on 'http://localhost'.

		  2) These files cannot be read by the Http plugin, as it sits outside of the webview and thus has no direct
			 connect. So instead we have to get to those files as blobs using fetch requests in the webview.

		  3) All files are served statically as bundled by the web server, except for the *.html files which Capacitor
			 injects about 2000 lines of Javascript for the framework in the <head>. Thus we need to strip out this
			 content before we cache HTML files, otherwise it will cause conflicts when that same file is served again
			 and Capacitor tries to inject the framework again at runtime, i.e. global var naming conflicts occur.

		  4) Capacitor had no official way of writing binary data to the disk. The Filesystem plugin however allows
			 for Base64 strings to be passed which it then internally decodes and writes as binary. This is because
			 the Capacitor bridge only allows for strings to be passed.

		  5) Beware that sending large strings through the bridge my end up crashing the web view, so it's not
			 feasible to attempt to write large media such as videos to the app container. For that purpose consider
			 building a native plugin that downloads and stores the file instead.
	
		For more info on the issue, see these links:

		  - Issue discussion: {@link https://github.com/ionic-team/capacitor/issues/31}
		  - Workaround: {@link https://stackoverflow.com/questions/56644178/how-can-i-save-a-downloaded-file-with-capacitor-in-ionic4-angular}
		  - Official feature request: {@link https://github.com/ionic-team/capacitor/issues/974}
	*/

	// Attempt to copy a file from the app bundle to the specified path.
	try {

		// Get the file from the app bundle local web server.
		const response = await fetch(url);

		// Parse the file response into a base64 string that can be sent through the Capacitor bridge.
		let base64Data = null;

		if (path.endsWith('.html')) {

			// Read the HTML file out as text.
			let text = await response.text();

			// Strip the injected Capacitor framework code out of the <head> tag.
			const stripStart = text.indexOf('<head>') + 6;
			const stripEnd = text.indexOf('</script>') + 9;

			text = text.substring(0, stripStart) + text.substring(stripEnd);

			// Convert the clean-up text to a base64 string.
			base64Data = btoa(text);

		} else {

			// Get a blob (binary) of the local file.
			const blob = await response.blob();

			// Convert the blob to a base64 string.
			base64Data = await new Promise((resolve, reject) => {

				const reader = new FileReader();
				reader.onerror = reject;
				reader.onload = () => {
					resolve(reader.result);
				};
				reader.readAsDataURL(blob);
			});
		}

		// Save the base64 data to disk. Capacitor will parse this back to a binary file type internally.
		await Filesystem.appendFile({
			path: path,
			directory: directory,
			data: base64Data
		});

	} catch (error) {

		console.debug(`AppUpdater: Could not copy '${path}' from app bundle`, error);

		return false;
	}

	return true;
}

// -------------------
// FILE SYSTEM HELPERS
// -------------------

/**
 * Creates a new direcory, ingoring warnings in case it already exists.
 * 
 * @private
 * 
 * @param {string} path - The path of the directory to create.
 * @param {Directory} directory - The base directory to work in.
 * 
 * @returns {void}
 */
async function createDir(path, directory) {

	if (!path) {
		return;
	}

	console.debug(`AppUpdater: Creating '${path}' directory`);

	try {

		await Filesystem.mkdir({
			path: path,
			directory: directory,
			recursive: true
		});

	} catch (ignore) {
		console.debug(`AppUpdater: Directory '${path}' already exists`);
	}
}

/**
 * Deletes a new direcory, ingoring warnings in case it has already been removed.
 * 
 * @private
 * 
 * @param {string} path - The path of the directory to remove.
 * @param {Directory} directory - The base directory to work in.
 * 
 * @returns {void}
 */
async function removeDir(path, directory) {

	if (!path) {
		return;
	}

	console.debug(`AppUpdater: Removing '${path}' directory`);

	try {

		await Filesystem.rmdir({
			path: path,
			directory: directory,
			recursive: true
		});

	} catch (ignore) {
		console.debug(`AppUpdater: Directory '${path}' already removed`);
	}
}