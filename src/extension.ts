import * as vscode from 'vscode';
import { InfinityDebugSession } from './infinityDebugAdapter';

/**
 * Called when the extension is activated.
 * 
 * @param context {vscode.ExtensionContext}
 */
export function activate( context: vscode.ExtensionContext ) {
	const provider = new InfinityConfigurationProvider();
	context.subscriptions.push( vscode.debug.registerDebugConfigurationProvider( 'infinity', provider ) );

	const factory: any = new InlineDebugAdapterFactory();
	context.subscriptions.push( vscode.debug.registerDebugAdapterDescriptorFactory( 'infinity', factory ) );

	if ( 'dispose' in factory ) {
		context.subscriptions.push( factory );
	}
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate() {
}

/**
 * Debug adapter factory.
 * Returns an inline debug adapter.
 */
class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	/**
	 * Creates the debug adapter descriptor.
	 * 
	 * @param _session {vscode.DebugSession}
	 * @return vscode.ProviderResult<vscode.DebugAdapterDescriptor>
	 */
	createDebugAdapterDescriptor( _session: vscode.DebugSession ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation( new InfinityDebugSession() );
	}

}

/**
 * Debug configuration provider.
 */
class InfinityConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Resolves the debug configuration.
	 * 
	 * @param folder {vscode.WorkspaceFolder}
	 * @param config {vscode.DebugConfiguration}
	 * @param token {vscode.CancellationToken}
	 * @return vscode.ProviderResult<vscode.DebugConfiguration>
	 */
	resolveDebugConfiguration( folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken ): vscode.ProviderResult<vscode.DebugConfiguration> {

		// Default config when running without a launch.json file:
		if ( !config.type && !config.request && !config.name ) {
			let os: string = 'linux-x64';
			let executable: string = 'infinity';

			switch ( process.platform ) {
				case 'darwin':
					os = 'osx-x64';
					break;

				case 'win32':
					os = 'win-x64';
					executable = 'infinity.exe';
					break;
			}

			config.type = 'infinity';
			config.request = 'launch';
			config.name = 'INFINITY: ' + ( config.noDebug ? 'Run' : 'Launch' ) + ' (' + os + ')';
			config.program = '${workspaceFolder}/js/main.js';
			config.runtime = '${workspaceFolder}/../' + os + '/' + executable;
		}

		return config;
	}
}
