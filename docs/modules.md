[@objekt/capacitor-app-updater](README.md) / Exports

# @objekt/capacitor-app-updater

## Table of contents

### References

- [default](modules.md#default)

### Variables

- [AppUpdater](modules.md#appupdater)

## References

### default

Renames and re-exports [AppUpdater](modules.md#appupdater)

## Variables

### AppUpdater

• `Const` **AppUpdater**: `Object`

CapacitorJS plugin to update the web contents of an app from a remote content server.

**`example`**
```js
import { AppUpdater } from '@objekt/capacitor-app-updater';

// Check for app updates on the remote content server.
const didUpdate = await AppUpdater.sync("https://your-web-server-url", 1000*60*60); // Only check once every 60 minutes.

// Stop processing if there was an update, as the updated would have triggered a page reload.
if (didUpdate) {
	return;
}

// Load the app shell.
// ... e.g. await import('./src/AppShell.js');
```

#### Type declaration

| Name | Type |
| :------ | :------ |
| `sync` | (`webServerURL`: `string`, `checkDelay`: `number`) => `Promise`<`boolean`\> |

#### Defined in

[AppUpdater.ts:69](https://github.com/objektlabs/capacitor-app-updater/blob/174dfcb/src/AppUpdater.ts#L69)
