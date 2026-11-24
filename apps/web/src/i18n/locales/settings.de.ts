import type { settingsEn } from './settings.en.ts';

/** Meldungen der Einstellungen, auf Deutsch. */
export const settingsDe: Record<keyof typeof settingsEn, string> = {
  'settings.nav': 'Bereiche der Einstellungen',
  'settings.group.activity': 'Tätigkeit',
  'settings.group.billing': 'Rechnungsstellung',
  'settings.group.connections': 'Verbindungen',
  'settings.group.notifications': 'Benachrichtigungen',
  'settings.group.account': 'Konto und Sicherheit',
  'settings.group.data': 'Daten',
  'settings.group.admin': 'Verwaltung',
  'settings.panel.profile': 'Profil und Situation',
  'settings.panel.companies': 'Unternehmen und Tätigkeiten',
  'settings.panel.rules': 'Länderregeln',
  'settings.panel.numbering': 'Nummerierung',
  'settings.panel.pdf': 'PDF-Gestaltung',
  'settings.panel.defaults': 'Standardwerte',
  'settings.panel.stripe': 'Stripe',
  'settings.panel.linked': 'Verknüpfte Instanzen',
  'settings.panel.sources': 'Externe Quellen',
  'settings.panel.assistants': 'KI-Assistenten',
  'settings.panel.reminders': 'Erinnerungen',
  'settings.panel.calendar': 'Kalender-Abo',
  'settings.panel.email': 'E-Mail-Versand',
  'settings.panel.password': 'Passwort',
  'settings.panel.two-factor': 'Anmeldung in zwei Schritten',
  'settings.panel.devices': 'Geräte',
  'settings.panel.data': 'Export und Import',
  'settings.panel.instance': 'Instanz und Berechtigungen',
  'settings.panel.packs': 'Pakete und Updates',
  'settings.form.invalid': 'Einige Felder müssen korrigiert werden.',
  'settings.profile.title': 'Unternehmensangaben',
  'settings.profile.body': 'Sie erscheinen auf Ihren Angeboten und Rechnungen.',
  'settings.profile.figures': 'Beginn und Währung',
  'settings.profile.saved': 'Profil gespeichert.',
  'settings.situation.body':
    'Ihr Status und Ihr Land bestimmen Fristen und Schwellen. Jede Änderung ist datiert, damit vergangene Zeiträume stimmen.',
  'settings.situation.history': 'Verlauf',
  'settings.situation.cease.consequence':
    'Fristen enden nach Ihrem letzten Tag und das Konto ist nur noch lesbar. Sie können das später rückgängig machen.',
  'settings.situation.cease.action': 'Erklären',
  'settings.situation.cease.next': 'Letzten Tag wählen',
  'settings.rules.none': 'Keine Länderregeln',
  'settings.rules.none.body':
    'Ihr Profil nutzt den allgemeinen Modus: Es werden keine Fristen oder Schwellen berechnet. Wählen Sie ein Land über „Status oder Land ändern“.',
  'settings.billing.numbering.body': 'Wie Ihre Angebote, Rechnungen und Gutschriften nummeriert werden.',
  'settings.billing.pdf.body': 'Farbe, Layout und Schrift der PDF-Dokumente, die Sie versenden.',
  'settings.billing.logo': 'Logo',
  'settings.billing.logo.removeBody':
    'Das Logo verschwindet aus neuen PDF-Dokumenten. Bereits versendete Dokumente bleiben unverändert.',
  'settings.billing.logo.removed': 'Logo entfernt.',
  'settings.on': 'Aktiv',
  'settings.off': 'Inaktiv',
  'settings.remove': 'Entfernen',
  'settings.stripe.synced.zero': 'Keine neuen Einnahmen.',
  'settings.stripe.synced.one': '1 neue Einnahme importiert.',
  'settings.stripe.synced.many': '{count} neue Einnahmen importiert.',
  'settings.stripe.imported.zero': 'Noch keine Einnahmen importiert.',
  'settings.stripe.imported.one': '1 Einnahme importiert.',
  'settings.stripe.imported.many': '{count} Einnahmen importiert.',
  'settings.stripe.lastSync': 'Letzte Synchronisierung: {date}.',
  'settings.stripe.remove.consequence':
    'Die Synchronisierung endet und der Schlüssel wird vom Server gelöscht. Bereits importierte Einnahmen bleiben.',
  'settings.technical': 'Technische Details',
  'settings.tokens.created': 'Token erstellt.',
  'settings.tokens.revoked': '„{name}“ widerrufen.',
  'settings.tokens.revoke.body':
    'Assistenten, die „{name}“ verwenden, verlieren sofort den Zugriff. Das ist endgültig.',
  'settings.tokens.empty': 'Noch keine Token',
  'settings.tokens.empty.body':
    'Erstellen Sie eines pro verbundenem Assistenten, damit Sie es einzeln widerrufen können.',
  'settings.tokens.name.hint': 'Der Assistent oder Rechner, der es nutzt, z. B. „Assistent Laptop“.',
  'settings.tokens.technical':
    'Assistenten verbinden sich mit {url} über das Model Context Protocol (MCP) und senden das Token als „Authorization: Bearer …“. Die Einrichtung steht in docs/mcp.md.',
  'settings.totp.enabled': 'Die Anmeldung in zwei Schritten ist aktiv.',
  'settings.totp.disabled': 'Die Anmeldung in zwei Schritten ist deaktiviert.',
  'settings.totp.disable.hint': 'Zum Deaktivieren der Anmeldung in zwei Schritten nötig.',
  'settings.sessions.body': 'Browser und Apps, die gerade mit Ihrem Konto angemeldet sind.',
  'settings.sessions.signOut': 'Abmelden',
  'settings.sessions.revoke.body': '{device} muss sich erneut anmelden.',
  'settings.sessions.signedOut': '{device} abgemeldet.',
  'settings.sessions.othersSignedOut': 'Alle anderen Geräte wurden abgemeldet.',
  'settings.sessions.revokeOthers.one':
    'Das andere Gerät muss sich erneut anmelden. Dieses bleibt angemeldet.',
  'settings.sessions.revokeOthers.many':
    '{count} andere Geräte müssen sich erneut anmelden. Dieses bleibt angemeldet.',
  'settings.reminders.body': 'Wann und wie Almanach Sie an anstehende Fristen erinnert.',
  'settings.reminders.email.hint': 'An Ihre Anmeldeadresse, über den Server aus',
  'settings.ical.none': 'Noch kein Link.',
  'settings.ical.revoked': 'Link widerrufen. Kalender, die ihn nutzen, werden nicht mehr aktualisiert.',
  'settings.ical.revoke.consequence': 'Mit diesem Link abonnierte Kalender erhalten Ihre Fristen nicht mehr.',
  'settings.ical.revoke.action': 'Widerrufen',
  'settings.ical.regenerate.body':
    'Der aktuelle Link funktioniert dann nicht mehr: Abonnierte Kalender müssen mit dem neuen neu eingerichtet werden.',
  'settings.activities.remove.body': 'Einträge dieser Tätigkeit werden wieder der Haupttätigkeit zugeordnet.',
  'settings.federation.label': 'Verknüpfte Instanzen sehen diese Tätigkeit als „{label}“.',
  'settings.federation.optionSaved': 'Verknüpfung aktualisiert.',
  'settings.federation.revoked': 'Verknüpfung widerrufen.',
  'settings.external.received.zero': 'Keine neuen Dokumente.',
  'settings.external.received.one': '1 Dokument empfangen.',
  'settings.external.received.many': '{count} Dokumente empfangen.',
  'settings.external.documents.zero': 'Noch keine Dokumente.',
  'settings.external.documents.one': '1 Dokument.',
  'settings.external.documents.many': '{count} Dokumente.',
  'settings.external.saved': 'Quelle gespeichert.',
  'settings.external.removed': 'Quelle entfernt.',
  'settings.external.empty': 'Keine externen Quellen',
  'settings.external.empty.body':
    'Fügen Sie eine hinzu, um Angebote und Rechnungen eines anderen Tools neben Ihren anzuzeigen.',
  'settings.external.technical':
    'Das andere Tool muss einen HTTPS-Feed im Format almanach-feed/1 veröffentlichen, geschützt durch ein Bearer-Token. Das Format steht in docs/external-sources.md.',
  'settings.packs.body':
    'Die mit Almanach gelieferten Regeln je Land und die seitdem installierten signierten Updates.',
  'settings.packs.new': 'Neu',
  'settings.packs.updates': 'Regel-Updates',
  'settings.packs.revert.body':
    'Für dieses Land gelten wieder die mit Almanach gelieferten Regeln. Sie können das Update aus dem Verlauf erneut anwenden.',
  'settings.packs.technical':
    'Updates werden mit den in PACK_PUBLIC_KEYS genannten Signaturschlüsseln geprüft; die automatische Suche nutzt PACK_UPDATE_URL. Beides wird in der Serverkonfiguration festgelegt.',
  'settings.mail.status': 'So werden E-Mails versendet',
  'settings.mail.body':
    'Almanach versendet Erinnerungen und Testnachrichten per E-Mail. Die Einstellung gilt für die ganze Instanz.',
  'settings.mail.on': 'Bereit',
  'settings.mail.off': 'Nicht eingerichtet',
  'settings.mail.env':
    'Die Serverkonfiguration versendet E-Mails über {host}. Sie hat Vorrang vor den Einstellungen unten.',
  'settings.mail.db': 'E-Mails werden mit {provider} von {from} versendet.',
  'settings.mail.none':
    'Derzeit werden keine E-Mails versendet: Erinnerungen bleiben in der App und als Push-Benachrichtigung.',
  'settings.mail.adminOnly': 'Nur ein Administrator kann diese Einstellung ändern.',
  'settings.mail.account': 'Postfach für den Versand',
  'settings.mail.account.body': 'Wählen Sie Ihren Anbieter: Sein Server wird für Sie eingetragen.',
  'settings.mail.account.env': 'Wird nur genutzt, wenn die Serverkonfiguration entfernt wird.',
  'settings.mail.noSecretsKey':
    'Um ein E-Mail-Passwort zu speichern, muss die Serververwaltung zuerst einen Verschlüsselungsschlüssel festlegen (SECRETS_KEY in der Serverkonfiguration).',
  'settings.mail.provider': 'Anbieter',
  'settings.mail.provider.gmail': 'Gmail',
  'settings.mail.provider.outlook': 'Outlook / Hotmail',
  'settings.mail.provider.icloud': 'iCloud Mail',
  'settings.mail.provider.yahoo': 'Yahoo Mail',
  'settings.mail.provider.fastmail': 'Fastmail',
  'settings.mail.provider.ovh': 'OVHcloud',
  'settings.mail.provider.infomaniak': 'Infomaniak',
  'settings.mail.provider.proton_bridge': 'Proton Mail (Bridge)',
  'settings.mail.provider.proton_token': 'Proton Mail (SMTP-Token)',
  'settings.mail.provider.other': 'Andere (SMTP)',
  'settings.mail.username': 'E-Mail-Adresse oder Benutzername',
  'settings.mail.from': 'Angezeigter Absender',
  'settings.mail.from.hint': 'Z. B. „Erika Muster <erika@example.com>“. Standardmäßig die Adresse oben.',
  'settings.mail.password': 'Passwort',
  'settings.mail.appPassword': 'App-Passwort',
  'settings.mail.smtpToken': 'SMTP-Token',
  'settings.mail.password.hint': 'Verschlüsselt gespeichert, nie wieder angezeigt.',
  'settings.mail.password.saved': 'Ein Passwort ist gespeichert. Geben Sie nur zum Ersetzen ein neues ein.',
  'settings.mail.host': 'Server',
  'settings.mail.port': 'Port',
  'settings.mail.port.tls': '{port} (TLS)',
  'settings.mail.port.starttls': '{port} (STARTTLS)',
  'settings.mail.port.hint':
    'Nur die Ports 465 und 587 werden genutzt: Port 25 ist in den meisten Netzen gesperrt und wird nie angeboten.',
  'settings.mail.saved': 'Einstellung gespeichert. Senden Sie eine Test-E-Mail zur Prüfung.',
  'settings.mail.test': 'Test-E-Mail senden',
  'settings.mail.test.sent':
    'Test-E-Mail an {to} gesendet. Prüfen Sie Ihren Posteingang (und den Spam-Ordner).',
  'settings.mail.detail': 'Servermeldung: {detail}',
  'settings.mail.error.auth_failed':
    'Der Mailserver hat die Anmeldung abgelehnt: Prüfen Sie Adresse und Passwort (ein App-Passwort bei Gmail, iCloud oder Yahoo).',
  'settings.mail.error.connection_failed':
    'Der Mailserver ist nicht erreichbar. Prüfen Sie den Servernamen oder ob Proton Mail Bridge läuft.',
  'settings.mail.error.timeout':
    'Der Mailserver hat nicht rechtzeitig geantwortet: Der Port ist vermutlich vom Netz oder Hoster gesperrt. Versuchen Sie den anderen Port.',
  'settings.mail.error.tls_failed':
    'Die sichere Verbindung ist fehlgeschlagen: Port und Verschlüsselung passen nicht zusammen oder das Zertifikat ist ungültig.',
  'settings.mail.error.oauth_failed':
    'Microsoft hat den Zugriff verweigert. Verbinden Sie das Outlook-Postfach erneut.',
  'settings.mail.error.not_configured': 'Speichern Sie zuerst ein Postfach.',
  'settings.mail.error.secrets_key_missing':
    'Der Server hat keinen Verschlüsselungsschlüssel (SECRETS_KEY), daher kann kein Passwort gespeichert werden.',
  'settings.mail.error.port_not_allowed':
    'Dieser Port ist nicht erlaubt. Nutzen Sie 465 oder 587; Port 25 wird nie verwendet.',
  'settings.mail.error.outlook_unavailable':
    'Die Outlook-Anmeldung ist auf diesem Server nicht eingerichtet (MS_OAUTH_CLIENT_ID).',
  'settings.mail.error.failed': 'Die E-Mail konnte nicht gesendet werden.',
  'settings.mail.field.loopback_required':
    'Proton Mail Bridge läuft auf diesem Rechner: Nutzen Sie 127.0.0.1 oder localhost.',
  'settings.mail.field.preset_host':
    'Dieser Anbieter nutzt seinen eigenen Server; wählen Sie „Andere (SMTP)“ für einen anderen.',
  'settings.mail.field.security_mismatch': 'Port 465 nutzt TLS und Port 587 STARTTLS.',
  'settings.mail.field.required': 'Geben Sie das Passwort ein.',
  'settings.mail.field.invalid_address':
    'Geben Sie eine Adresse wie erika@example.com oder „Erika <erika@example.com>“ ein.',
  'settings.mail.help.gmail':
    'Gmail braucht ein App-Passwort, nicht Ihr übliches Passwort. Dafür muss die Bestätigung in zwei Schritten in Ihrem Google-Konto aktiv sein. Erstellen Sie es unter',
  'settings.mail.help.icloud':
    'iCloud braucht ein app-spezifisches Passwort (Zwei-Faktor-Authentifizierung aktiv). Erstellen Sie es unter Anmeldung und Sicherheit auf',
  'settings.mail.help.yahoo': 'Yahoo braucht ein App-Passwort: Kontosicherheit → App-Passwort generieren.',
  'settings.mail.help.protonBridge':
    'Proton Mail Bridge muss auf demselben Rechner wie Almanach laufen. Kopieren Sie Benutzername und Passwort aus Bridge (nicht Ihr Proton-Passwort).',
  'settings.mail.help.protonToken':
    'Mit einem kostenpflichtigen Proton-Tarif und eigener Domain erstellen Sie in Proton Mail ein SMTP-Token: Einstellungen → IMAP/SMTP → SMTP-Token.',
  'settings.mail.help.outlook':
    'Outlook.com und Hotmail akzeptieren keine Passwörter mehr: Sie melden sich bei Microsoft an und erlauben den Versand einmal.',
  'settings.mail.help.outlookSetup':
    'Die Outlook-Anmeldung braucht eine bei Microsoft registrierte Anwendung, einmal pro Server. Die Serververwaltung geht so vor (Details in docs/email.md):',
  'settings.mail.help.outlookStep1':
    'Im Azure-Portal (Microsoft Entra ID → App-Registrierungen) eine Registrierung für „Nur persönliche Konten“ ohne Umleitungsadresse anlegen.',
  'settings.mail.help.outlookStep2':
    'Unter Authentifizierung „Öffentliche Clientflows zulassen“ auf Ja setzen.',
  'settings.mail.help.outlookStep3':
    'Unter API-Berechtigungen SMTP.Send und offline_access (delegiert) hinzufügen.',
  'settings.mail.help.outlookStep4':
    'Die Anwendungs-ID (Client) in MS_OAUTH_CLIENT_ID der Serverkonfiguration eintragen und Almanach neu starten.',
  'settings.mail.outlook.title': 'Microsoft-Anmeldung',
  'settings.mail.outlook.body':
    'Geben Sie oben Ihre Outlook- oder Hotmail-Adresse ein und verbinden Sie sich: Microsoft zeigt eine Seite, auf der Sie einen Code eingeben und den Versand erlauben.',
  'settings.mail.outlook.connectedBody': 'Das Postfach ist verbunden. Almanach erneuert den Zugriff selbst.',
  'settings.mail.outlook.badge': 'Verbunden',
  'settings.mail.outlook.connect': 'Mit Microsoft verbinden',
  'settings.mail.outlook.reconnect': 'Erneut verbinden',
  'settings.mail.outlook.step':
    'Öffnen Sie diese Seite, melden Sie sich mit der Adresse oben an und geben Sie den Code ein:',
  'settings.mail.outlook.code': 'Einzugebender Code',
  'settings.mail.outlook.waiting': 'Warten auf Ihre Zustimmung auf der Microsoft-Seite…',
  'settings.mail.outlook.connected': 'Outlook-Postfach verbunden.',
  'settings.mail.outlook.declined': 'Der Zugriff wurde auf der Microsoft-Seite abgelehnt.',
  'settings.mail.outlook.expired': 'Der Code ist abgelaufen. Verbinden Sie sich erneut für einen neuen.',
  'settings.mail.remove': 'Postfach entfernen',
  'settings.mail.remove.consequence':
    'Es werden keine E-Mails mehr versendet; das gespeicherte Passwort oder der Microsoft-Zugriff wird gelöscht.',
  'settings.mail.remove.env':
    'Das gespeicherte Passwort oder der Microsoft-Zugriff wird gelöscht. Die Serverkonfiguration versendet weiter E-Mails.',
  'nav.home': 'Start',
  'clients.delete.label': 'Diesen Kunden löschen',
  'missions.delete.label': 'Diesen Auftrag löschen',
  'custom.delete.label': 'Diese Frist löschen',
  'calendar.empty.body': 'Wählen Sie einen anderen Zeitraum oder fügen Sie eine eigene Frist hinzu.',
  'clients.missions.empty.body':
    'Legen Sie einen an, um Zeit zu erfassen und diesem Kunden Rechnungen zu stellen.',
  'time.unbilled.none.body': 'Neu erfasste Zeit für Stunden- oder Tagesaufträge erscheint hier.',
  'time.week.empty.body': 'Starten Sie die Stoppuhr oder fügen Sie oben einen Eintrag hinzu.',
};
