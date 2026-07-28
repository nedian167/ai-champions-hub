// Single source of truth for the app version shown in the UI.
//
// Bump this on every shipped change and keep it in sync with:
//   - package.json  "version"
//   - the Dataverse solution version (pac solution version ...), using
//     APP_VERSION + ".0"  ->  e.g. "1.0.1" here means solution "1.0.1.0".
//
// Increasing the solution version on each deploy is what lets an import be
// applied as an UPGRADE (existing data is preserved) instead of a reset.
export const APP_VERSION = '1.0.1';
