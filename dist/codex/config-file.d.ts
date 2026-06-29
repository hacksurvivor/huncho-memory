export interface PathmarkMcpStatus {
    installed: boolean;
    hooksFeatureEnabled: boolean;
}
export declare function installPathmarkMcp(configPath?: string): Promise<void>;
export declare function removePathmarkMcp(configPath?: string): Promise<void>;
export declare function hasPathmarkMcp(configPath?: string): Promise<boolean>;
export declare function pathmarkMcpStatus(configPath?: string): Promise<PathmarkMcpStatus>;
export declare function enableHooksFeature(content: string): string;
