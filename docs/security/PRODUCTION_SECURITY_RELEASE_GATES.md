# Production Security Release Gates

Stand: 15.09.2026

EDS Diary darf derzeit **nicht** als „production secure“ veröffentlicht werden.

| Gate | Status | Erforderlich |
|---|---|---|
| CSP | Blockiert | Hosting mit kontrollierbarer nonce-/hash-basierter CSP; kein unnötiges Drittanbieter-Script im Diary-Origin. |
| Auth-Origin | Blockiert | Separater statischer Google-Auth-Origin und request-/action-gebundener, replay-resistenter Handoff. Der Hauptorigin ist bis dahin fail-closed. |
| Dependency/Runtime JS | Teilweise | Google GIS wurde aus dem Hauptorigin entfernt. Das lokal gebündelte QR-Script und alle Dependencies müssen weiter reviewed werden. |
| Referrer Policy | Blockiert | Serverseitig `Referrer-Policy: no-referrer` setzen und verifizieren. |
| Permissions Policy | Blockiert | Minimal benötigte Features serverseitig erlauben; Kamera nur für explizites Pairing/QR falls benötigt. |
| Build/Pinning | Teilweise | Neue Security-/Testdependencies sind exakt gepinnt; Lockfile ist committed. `npm audit` verbleibt als Release-Gate. |
| Source Maps/Logs | Blockiert | Produktionsbuild und Hosting auf öffentliche Source Maps sowie Log-/Error-Payloads prüfen. |
| Token Storage | Erfüllt im Codepfad | Kein Token in Browserstorage; Google-Auth bleibt bis Origin-Isolation deaktiviert. |
| XSS Rendering | Teilweise | React-Escaping wird verwendet; Architekturtest prüft Storagepfade. Vollständiger externer Review bleibt nötig. |
| Kryptographie | Blockiert | Die Spezifikation definiert keine vollständige Manifest-/Envelope-AAD-Byteform. Der Google-Einstieg bleibt gesperrt, bis normative Vektoren vorliegen. |
| Live Google Contract | Blockiert | Credentials, isolierter Auth-Origin und Test-Spreadsheet fehlen; lokale Fake-/Codec-Tests ersetzen keinen Live-Test. |

## Zulässige Aussage

„Konservativer clientseitiger Kryptographieentwurf mit expliziten Threat-Model-Grenzen; nicht extern auditiert.“
