# Consent to Script Splitting (Optional)

Effective Date: The date this version is published (shown on the consent screen when you add a script and in the consent list in Settings)

This consent is **optional**. Without it, you can still use script reading with the sample script. To paste your own script or add one from a file, this consent is required.

## 1. What You Are Consenting To
When you paste a script or add one from a file, the **script text** is sent through our server to OpenAI's AI service (OpenAI API) so it can be split into characters, lines, and stage directions. To correct the split result, part of the script text is also sent to an AI decision model reached through OpenRouter (OpenRouter API). If you add a file, we keep the **original file** in our storage.

## 2. What Is Sent and What Is Kept
- Sent to OpenAI: the script text (for a file, the text extracted from it). A long script is sent in several parts, each with the list of character names in that script.
- Sent to OpenRouter: the text of the line being checked and the lines around it, and the list of character names in that script. When splitting lines without character names, the beginning of the script (up to 3,000 characters) is sent to check that it is spoken text.
- Kept in our storage: the original file, if you added one

We do not send anything that identifies you, such as your name or email, to OpenAI or OpenRouter. We send requests with the setting that tells OpenAI not to store them.

## 3. Purpose
To split the script into characters, lines, and stage directions and save it for script reading. The original file is kept so the script can be read again when needed, and an original file that could not be read or split is kept to find and fix the cause of that failure. Nothing else.

## 4. Processors and Overseas Transfer
- Processor: OpenAI (OpenAI API) for script splitting
- Processor: OpenRouter, Inc. (OpenRouter API) for correcting the split result
- Processor: Amazon Web Services (AWS) for storing original files
- Destination: overseas servers operated by each processor
- When and how: over an encrypted network each time you add a script
- See the Privacy Policy for the full list of processors and overseas transfers.

## 5. Retention
- A split script is kept until you delete it or withdraw from the service.
- An original file is kept with the script made from it and is deleted together when you delete that script or withdraw. Among original files that did not become a script, a file that could not be read or split is kept for one year to find and fix the cause and is then deleted; other original files (duplicates and so on) are deleted after one day. If you withdraw this consent or withdraw from the service, kept files are deleted too.

## 6. Changing Your Consent
You can withdraw at any time from the consent list in Settings. After you withdraw, you cannot add new scripts. Scripts already saved stay; delete a script to remove it.

## 7. Right to Refuse
You may refuse this consent. If you refuse, you cannot paste your own script or add one from a file, and you can use script reading only with the sample script. No other feature is affected.

## 8. Contact
- Operator: Acttub
- Contact: acttub0527@gmail.com
