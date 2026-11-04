interface EmscriptenModuleConfig {
	canvas: HTMLCanvasElement;
	preRun?: Array<(module: any) => void>;
}

declare module '*client.js' {
	export default function createEngine(config?: EmscriptenModuleConfig): Promise<any>;
}
