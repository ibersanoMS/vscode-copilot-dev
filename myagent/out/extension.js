"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const core_1 = require("@octokit/core");
// Use this prompt to initiate some context with the model when the user activates this agent
const prompt = "Git branching";
const agentName = 'test-agent';
const description = 'test';
const fullName = '@test-agent';
// This method is called when the VS Code extensions are activated
// this can be configured in package.json under "activationEvents"
function activate(context) {
    //show a toast message when the extension is loaded
    vscode.window.showInformationMessage(`Loaded ${fullName}`);
    // Your the create handler will be called the very first time the @agent is invoked with copilot
    // and Copilot needs to load the agent.
    const agent = vscode.chat.createChatAgent(agentName, async (request, context, progress, token) => {
        if (request.slashCommand?.name == 'branch') {
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
exports.activate = activate;
// This method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;
async function handleBranch(request, context, progress, token) {
    const access = await vscode.chat.requestChatAccess('copilot');
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const issueNumber = Number(request.prompt);
    const githubToken = await connectToGitHub();
    const octokit = new core_1.Octokit({
        auth: githubToken.accessToken
    });
    const repo = gitExtension?.getAPI(1).getRepository(gitExtension?.getAPI(1).repositories[0]?.rootUri);
    const owner = gitExtension?.getAPI(1).repositories[0]?.state?.remotes[0]?.fetchUrl?.split('/')[3];
    const repoName = gitExtension?.getAPI(1).repositories[0]?.state?.remotes[0]?.fetchUrl?.split('/')[4].split('.')[0];
    const issue = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
        owner: owner || 'default_owner',
        repo: repoName || 'default_repo_name',
        issue_number: issueNumber,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
    const issueType = (typeof issue.data.labels[0] === 'string') ? issue.data.labels[0] : issue.data.labels[0]?.name;
    const branchName = issueType + '/' + issueNumber + '-' + issue.data.title.replace(/ /g, '-');
    await gitExtension?.getAPI(1).repositories[0].createBranch(branchName, true, gitExtension?.getAPI(1).repositories[0]?.state?.HEAD?.commit);
    //const createBranch = await gitExtension?.exports.getAPI(1).repositories[0].createBranch();
    //console.log(gitExtension?.exports.getAPI(1).repositories[0]?.state?.remotes[0]?.fetchUrl?.split('/')[2]);
    const promptRequest = access.makeRequest([
        { role: vscode.ChatMessageRole.System, content: 'Branching...' },
    ], {}, token);
    for await (const chunk of promptRequest.response) {
        if (token.isCancellationRequested) {
            break;
        }
        progress.report({ content: chunk });
    }
    return "branching function completed";
}
async function connectToGitHub() {
    const session = await vscode.authentication.getSession("github", ["read:user", "user:email", "repo"], {
        createIfNone: true
    });
    return { accessToken: session.accessToken, sessionId: session.id };
}
//# sourceMappingURL=extension.js.map