import * as vscode from 'vscode';
import { GitExtension } from './git';
import { Octokit } from "@octokit/core";
import { WriteStream } from 'fs';
import { stringify } from 'querystring';
import { error } from 'console';

// Use this prompt to initiate some context with the model when the user activates this agent
const prompt = "Git branching";
const agentName = 'test-agent';
const description = 'test';
const fullName = '@test-agent';

// This method is called when the VS Code extensions are activated
// this can be configured in package.json under "activationEvents"
export function activate(context: vscode.ExtensionContext) {
	//show a toast message when the extension is loaded
	vscode.window.showInformationMessage(`Loaded ${fullName}`);

	// Your the create handler will be called the very first time the @agent is invoked with copilot
	// and Copilot needs to load the agent.
	const agent = vscode.chat.createChatAgent(agentName, async (request: vscode.ChatAgentRequest,
		context: vscode.ChatAgentContext,
		progress: vscode.Progress<vscode.ChatAgentProgress>,
		token: vscode.CancellationToken) => {
		 
		if (request.slashCommand?.name == 'branch'){
			console.debug('branch command received');
			return handleBranch(request, context, progress, token);
		}
		//get access to chat so that we can interact with the model
		const access = await vscode.chat.requestChatAccess('copilot');

		//send a "system" prompt to the model  -- the user won't see this
		const promptRequest = access.makeRequest([
			{ role: vscode.ChatMessageRole.System, content: prompt },
		], {}, token);

		//the response is a readable stream of messages, so we just
		//report them as they come in so they are displayed in the chat UI
		for await (const chunk of promptRequest.response) {
			if (token.isCancellationRequested) {
				break;
			}
			progress.report({ content: chunk });
		}
		return {};
	});

	agent.description = description;
	agent.fullName = fullName;
	agent.iconPath = new vscode.ThemeIcon('smiley');
	agent.slashCommandProvider = {
		provideSlashCommands(token) {
			return [
				{ name: 'branch', description: 'Creating a branch on the current git repository' }
			];
		},
	};
	context.subscriptions.push(agent);
}

// This method is called when your extension is deactivated
export function deactivate() { }

async function handleBranch(request: vscode.ChatAgentRequest, context: vscode.ChatAgentContext, progress: vscode.Progress<vscode.ChatAgentProgress>, token: vscode.CancellationToken) {
		progress.report({ content: 'Creating branch according to repository standards...\n' });
		const patternFile = await vscode.workspace.findFiles('**/standards.txt');
		const openDoc = await vscode.workspace.openTextDocument(patternFile[0]);
		const text = openDoc.getText().trimEnd();
		const supportedFields = ['{userId}', '{label}', '{title}', '{description}', '{type}', '{number}'];
		const fieldsRequireGitHub = ['{userId}', '{label}', '{title}', '{number}'];
		const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;

		// Input string
		const inputString: string = text;

		// Regular expression pattern to match names in curly braces
		//const pattern: RegExp = /\{([^}]+)\}/g;
		const pattern: RegExp = /\{([^{}]+)\}/g;

		// Find all matches
		const matches: string[] = inputString.match(pattern) || [];
		let userIdValue: string = "";
		let labelValue: string | undefined = "";
		let titleValue: string | undefined = "";
		let descriptionValue: string | undefined = "";
		let typeValue: string | undefined = "";
		let numberValue: number = Number(request.prompt)? Number(request.prompt) : -1;
		let issue: any; 
		let githubConnectionInfo: any;

		const hasUnallowedTerms: boolean = matches.some(term => !supportedFields.includes(term));
		if(hasUnallowedTerms){
			progress.report({content: "Error: You used a term that is not currently supported. The supported terms are: {userId}, {label}, {title}, {description}, {type}, {number}. Please try again."});
		}
		
		if(matches.some(term => fieldsRequireGitHub.includes(term))){
			if(vscode.extensions.getExtension('GitHub.vscode-pull-request-github')?.isActive){
				githubConnectionInfo = await connectToGitHub();
				if(numberValue !== -1){
					const octokit = new Octokit({
						auth: githubConnectionInfo.accessToken
					});
				
					const repo = gitExtension?.getAPI(1).getRepository(gitExtension?.getAPI(1).repositories[0]?.rootUri);
					const owner = gitExtension?.getAPI(1).repositories[0]?.state?.remotes[0]?.fetchUrl?.split('/')[3];
					const repoName = gitExtension?.getAPI(1).repositories[0]?.state?.remotes[0]?.fetchUrl?.split('/')[4].split('.')[0];
		
					issue = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
											owner: owner || 'default_owner',
											repo: repoName || 'default_repo_name',
											issue_number: numberValue,
											headers: {
												'X-GitHub-Api-Version': '2022-11-28'
											}
										});
				}
			}
			else {
				return "Error: You are not connected to GitHub. Please connect to GitHub and try again.";
			}
		}
		
		matches.forEach(async match => {
			switch(match.slice(1, -1)){
				case 'description':
					descriptionValue = request.prompt.split(' ').slice(1).join('-');
					break;
				case 'type':
					typeValue = request.prompt.split(' ')[0];
				case 'userId':
					userIdValue = githubConnectionInfo.userId;
					break;
				case 'label':
					labelValue = (typeof issue.data.labels[0] === 'string') ? issue.data.labels[0] : issue.data.labels[0]?.name;
					break;
				case 'number':
					if(numberValue === -1)
					{
						return "Error: Your standards requires an issue number. Please try again with a valid issue number."
					}
					break;
				case 'title':
					titleValue = issue.data.title.replace(/ /g, '-');
					break;
				default:
					return "Error: Invalid parameter. Please check the standards.txt file.";
			}
		});

		// Replace the matched names with the corresponding values
		let branchName: string = inputString;
		let errorMessage: string | null = null;
		matches.forEach(match => {
			if(eval(`${match.slice(1,-1)}Value`) === ""){
				errorMessage = `Error: You are missing a value for ${match.slice(1,-1)}. Please try again.`
			}
			else{
				branchName = branchName.replace(`${match}`, eval(`${match.slice(1,-1)}Value`));
			}
		});
		
		const refNamePattern: RegExp = /^(?![^\/]+$)(?:(?!\/{2,})[^\0\\~^:?*\[\]\s][^\0\\~^:?*\[\]]*\/)*[^\0\\~^:?*\[\]\s][^\0\\~^:?*\[\]]*$/;

    		// Test if the ref name matches the pattern
   		 
		if(errorMessage !== null || !refNamePattern.test(branchName)) {
			progress.report({ content: errorMessage !== null ? errorMessage : "Error: The branch name is not valid. Please try again." });
			return;
		}
		else {
			
			await gitExtension?.getAPI(1).repositories[0].createBranch(branchName, true, gitExtension?.getAPI(1).repositories[0]?.state?.HEAD?.commit);

			progress.report({ content: `Branch ${branchName} created` });
	
			return "branching function completed";
		}
}

 async function connectToGitHub() {
	const session = await vscode.authentication.getSession("github", ["read:user", "user:email", "repo"], {
		createIfNone: true
	});
	return { accessToken: session.accessToken, sessionId: session.id, userId: session.account.label };
}