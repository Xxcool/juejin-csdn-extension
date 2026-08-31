import type {PlatformAdapter} from './adapter';
export const csdnAdapter:PlatformAdapter={id:'csdn',name:'CSDN',editorUrl:'https://editor.csdn.net/md/',transform(article){return{...article};}};
