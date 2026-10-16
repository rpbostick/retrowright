// npm run licenses: writes THIRD_PARTY_LICENSES from the installed dependencies.

import { writeFileSync } from "node:fs";
import { bundledPackages, LICENSES_FILE, thirdPartyLicenses } from "./thirdPartyLicenses";

writeFileSync(LICENSES_FILE, thirdPartyLicenses());
for (const pkg of bundledPackages()) console.log(`${pkg.name} ${pkg.version}: ${pkg.licence}`);
console.log(`Wrote ${LICENSES_FILE}.`);
