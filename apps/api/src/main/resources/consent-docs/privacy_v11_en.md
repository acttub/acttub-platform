# Consent to the Collection and Use of Personal Information

Effective Date: The date this version is published (shown on the app's consent screen and in the consent list in Settings)

ACTTUB (액터브, hereinafter the "Company") collects and uses personal information as set out below in order to provide the Service. This document is **a document that obtains consent**. General matters concerning processing — entrustment, cross-border transfer, and users' rights — are addressed separately in the **Privacy Policy**, a notice document that is not subject to consent.

## 1. Information Required for the Account
- Social login identifier (the account identifier provided by Google, Apple, Kakao, or Naver)
- Email address — the Company stores **only the address the login provider reports as verified**. If the user has not consented to providing an email, or the address is unverified, it is not stored.

Purpose of use: Identity verification and login, and linking the user to the same account even when signing in through a different login method.

## 2. Required Profile Information
At sign-up, the user is asked to enter the following six items once. All of them are used so the AI coach can tailor its guidance to the user from the very first practice session, and the user can change them at any time in Settings.

| Item | Reason it is used for coaching |
| --- | --- |
| Name | The name the coach uses to address the user, and the name displayed as the author on challenge submissions and comments |
| Gender | Used to set assumptions appropriate to the user when interpreting roles and scenes ("Prefer not to say" may be selected) |
| Date of birth | Used to calculate age and suggest roles and assignments suited to the user's age group, and to prevent sign-up by anyone under 14 years of age |
| Acting focus | Screen acting and stage acting differ in scale and standard of expression, so this is used to set the standard for feedback |
| Acting experience | Used to match the depth of explanation and level of terminology to the user's experience |
| Ultimate goal | Used to set the direction of practice suggestions depending on whether the goal is a hobby, auditions, or a professional acting career |

Other than the name, these items are visible only to the user. However, if the user turns on a portfolio share link, the name, profile photo, gender, and age are displayed together on that public page.

## 3. Optional Information
- Profile photo, short bio — collected only when the user personally enters them in Settings.
- Portfolio (introduction, career history, photos) — collected only when the user personally enters them.

There is no restriction on using the Service even if the user does not provide this optional information.

## 4. Information Generated While Using the Service
- Acting videos and audio, scripts, and reading recordings uploaded by the user
- Analysis results, coach conversations, practice notes, and practice context the coach remembers
- The device's push token for receiving notifications and notification settings
- Service usage records, access logs, and device information
- Cookie-based identifiers and visit records for web usage analysis (Google Analytics)
- Records of actions performed on the web, screen recordings that preserve usage screens in a replayable form, and the IP address with the approximate location estimated from it (PostHog)
- Records of actions performed in the mobile app, screen recordings that preserve app screens in a replayable form, the IP address with the approximate location estimated from it, and the member identification number of members who have completed sign-up (PostHog)
- Screen and action records in the mobile app, and the member identification number of members who have completed sign-up (Google Analytics for Firebase)
- Error logs automatically recorded when an error occurs, and the member identification number of signed-up members (Sentry)
- Crash records left when the mobile app terminates abnormally, and the member identification number of members who have completed sign-up (Firebase Crashlytics)
- Ad performance measurement data in the mobile app: app install and launch records, sign-up completion and practice analysis completion records, device information and IP address, advertising identifier (on iOS, only if the user allows "App Tracking"), information about the ad that led to the install, and the member identification number (Airbridge, Meta)
- First acquisition source of the signed-up account: in the app, the channel, campaign, ad set, and creative names of the ad that led to the install; on the web, the campaign parameters in the visited address (utm values).
- Identifier of the sign-up device used to look up the first acquisition source in the app: the advertising ID on Android; on iOS, the advertising identifier if the user allows "App Tracking," otherwise the identifier for vendors (IDFV). The Company uses it to look up the install ad in Airbridge, destroys it as soon as the lookup ends, and never keeps it longer than 24 hours after receiving it.

Screen recordings on the web and in the mobile app are made without masking the screen, so they may contain the scripts, coach conversations, and practice notes shown on screen, as well as what the user types into input fields.

Purpose of use: Providing analysis and coaching; identifying where users encounter difficulty in order to improve features; detecting and recovering from errors; and measuring ad performance, i.e., checking which ads led to app installs and sign-ups. The entrusted companies, cross-border transfers, retention periods by item, and how to opt out are addressed in the Privacy Policy.

Analyzing facial expressions, emotions, and the like from video is governed by a separate **AI Analysis Consent**.

### AI processing of script text in script reading
This consent covers the following two kinds of processing in script reading. They used to require the separate "Script Splitting" and "Premium Reading Voice" consents; since v9 they are part of this consent.
- **Script splitting**: To split a script you paste or add from a file into roles, lines, and stage directions, the **script text** is sent through our server to OpenAI (OpenAI API). Long scripts are sent in several chunks, each with the list of role names in that script. Requests are sent with settings that keep them from being stored on OpenAI's side. To correct the split result, **part of the script text** (the line being checked and the lines around it, or up to the first 3,000 characters when splitting lines without role names), together with the list of role names, is also sent through our server to an AI decision model reached through OpenRouter (OpenRouter API). If you add a file, the original file is kept in our storage (AWS).
- **Premium voice**: If you turn on the "premium voice" on the reading screen, **one line of the partner's dialogue and the chosen voice type** are sent through our server to Google's speech synthesis service (Gemini) so it can be read in a natural voice. If you do not turn it on, lines never leave your device. Generated audio is kept so the same sentence is not generated again, and it is not linked to which user requested it.

Neither kind of processing sends information that identifies you, such as your name or email, and neither is used for any other purpose. Data is sent to servers outside Korea; details of entrustment and cross-border transfer are in the Privacy Policy. Split scripts and original files are kept until you delete the script or your account. Among original files that did not become a script, files that could not be read or split are kept for one year to find and fix the cause and are then deleted; other original files are deleted after one day.

### When paying for a subscription (Pro)
The following information arises from users who pay for Pro from November 1, 2026. However, the member number and device information for subscription status management (RevenueCat) may also be transmitted, as described below, for members who have not paid.
- Common: the subscription product (monthly/annual) and amount, the payment channel (web, App Store, Google Play), the dates and status of subscription start, renewal, expiry, cancellation, and refund, records of failed payments and retries, records of free periods and promotions set by the Company being applied, records of consent to conversion to paid and to price increases, and records of cancellation and refund inquiries and their handling
- Web payment (Toss Payments): the user enters card information directly in the Toss Payments payment window, and **the Company does not store full card numbers.** The Company stores, encrypted, the recurring-payment key (billing key) issued by Toss Payments, and stores the card issuer name, the card number partially masked by Toss Payments, and the order number, payment number, amount, and date and time of payment.
- In-app payment (App Store, Google Play): Apple and Google contract directly with the user for payment and process the payment information. As the result of payment, the Company receives the product, the subscription period and status, and the store transaction identifier (Apple original transaction ID, Google purchase token).
- Subscription status management (RevenueCat): after the Company opens app payments, the Company's internal member number (app user ID) is transmitted to RevenueCat when a signed-in member who is not on Pro launches or reopens the app (to find purchases that were paid but not yet reflected) and when the user purchases or restores purchases on the Pro screen; RevenueCat processes the device type and operating system, last-seen time, store receipts and purchase tokens, and transaction history. Names and email addresses are not sent. RevenueCat uses the IP address only to determine the country and does not store it. Web payments are not sent to RevenueCat.

Purposes: providing Pro and checking subscription status, charging fees and automatic renewal, handling cancellation, withdrawal of subscription, and refunds, notifying failed payments, notice of and recording consent to conversion to paid and price changes, preventing fraudulent payments, and keeping transaction records as required by law. Entrustment of payment processing and the cross-border transfer (RevenueCat, United States) are described in the Privacy Policy.

## 5. Retention and Use Period
- Retained while the user remains a member, and **destroyed without delay upon withdrawal of membership.**
- The sign-up device identifier used to look up the first acquisition source is destroyed as soon as the lookup ends, and at the latest within 24 hours after it is received.
- Destroyed upon withdrawal: email, name, profile photo, short bio, portfolio, social login identifier, login/push tokens, the first acquisition source of the account and any sign-up device identifier not yet destroyed, and videos and recordings (if the user has consented to "Retention and Use of Video/Recordings After Withdrawal," that document governs instead).
- Retained after withdrawal, pseudonymized so the individual cannot be identified, for statistical and research purposes: gender, age group in 5-year bands (the date of birth itself is deleted), acting focus, acting experience, ultimate goal, practice records, and practice context the coach remembers.
- The social login identifier is converted into a non-recoverable value (a hash) and retained for 3 years after withdrawal. Its only use is to verify the user's identity when the user requests withdrawal of consent under "Retention and Use of Video/Recordings After Withdrawal."
- Data may remain in backups for up to 30 days before it is destroyed.
- If the user has paid for Pro, the following records are kept separately even after withdrawal and then destroyed, as required by the Act on the Consumer Protection in Electronic Commerce, etc.: records on contracts or withdrawal of subscription, 5 years; records on payment and supply of goods, 5 years; records on consumer complaints or dispute resolution, 3 years. The billing key for web payment is destroyed when the subscription ends (if automatic renewal was cancelled, when the period of use ends) or immediately upon withdrawal. The member number and payment records held by RevenueCat are not deleted automatically upon withdrawal; users may request deletion through customer support.

## 6. Children Under 14 Years of Age
The Service does not accept sign-ups from children under 14 years of age. If the date of birth entered during sign-up indicates the user is under 14, the account and the information entered are destroyed immediately.

## 7. Right to Refuse Consent
Users may refuse this consent. The payment information in Section 4 arises when the user pays for Pro (RevenueCat transmission occurs in the cases described in Section 4), and not paying does not limit use of the Free Service. However, Sections 1 and 2 above concern information essential to providing the Service, so if the user does not consent, the user cannot use the Service. After signing up, the way to withdraw this consent is to withdraw membership.

## 8. Contact
- Operator: ACTTUB (액터브), Representative WooYoung Choi (최우영)
- Contact: acttub0527@gmail.com

**Revision History**
- **v11** — Added to Section 4 the purchase and subscription information that arises when paying for a subscription (Pro) and its purposes, and added to Section 5 the transaction records kept after withdrawal as required by law and the destruction of the billing key. Entrustment of payment processing (Toss Payments) and subscription status management (RevenueCat, Inc., United States) and the cross-border transfer are described in the Privacy Policy. Changed the operator name to ACTTUB (액터브).
- **v10** — Added to Section 4 that, to correct the split result, part of the script text and the list of role names are sent to OpenRouter (OpenRouter API).
- **v9** — Merged script reading's "Script Splitting" (sending script text to OpenAI) and "Premium Voice" (sending the partner's line to Google Gemini), which used to be separate optional consents, into this consent and described them in Section 4. Added to the collected items (Section 4) the sign-up device identifier (advertising ID on Android; advertising identifier or IDFV on iOS) that is used to look up the first acquisition source of the account in Airbridge, and added to the retention period (Section 5) that this identifier is destroyed right after the lookup and at the latest within 24 hours. This replaces the v7 sentence that advertising identifiers are not stored in the account.
- **v8** — Briefly published on 2026-10-16 and withdrawn to match the app release. Its content is the same as v9.
- **v7** — Changed the provider of action records and screen recordings on the web from Amplitude to PostHog, and added action records and screen recordings in the mobile app (PostHog), crash records in the mobile app (Firebase Crashlytics), and the member identification number attached to error and crash records to the collected items (Section 4). Stated in Section 4 what screen recordings may contain.
- **v6** — Added screen and action records in the mobile app (Google Analytics for Firebase), ad performance measurement data in the mobile app (Airbridge, Meta) and the first acquisition source of the signed-up account to the collected items and purposes (Section 4), and added the first acquisition source to the items destroyed upon withdrawal (Section 5).
- **v5** — Changed the nature of the document from "Privacy Policy" to **"Consent to the Collection and Use of Personal Information."** Separated the Privacy Policy out as a notice document not subject to consent. Added the six required profile items and the reason each is used for coaching (Section 2); Kakao and Naver login (Section 1); the scope of destruction and pseudonymization upon withdrawal and retention of a hashed identifier (Section 5); and the prohibition on sign-up by anyone under 14 years of age (Section 6).
- v1–v4 — Published under the name "Privacy Policy."
