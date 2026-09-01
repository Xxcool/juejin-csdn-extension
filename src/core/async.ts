// 同步流程的通用异步控制：提供有限并发和带退避的失败重试。
export async function retry<T>(operation:()=>Promise<T>,attempts=3,baseDelay=300):Promise<T>{
  let lastError:unknown;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await operation();}catch(error){
      lastError=error;
      if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,baseDelay*2**(attempt-1)));
    }
  }
  throw lastError;
}

export async function mapConcurrent<T,R>(items:T[],limit:number,worker:(item:T,index:number)=>Promise<R>):Promise<R[]>{
  const results=new Array<R>(items.length);
  let cursor=0;
  async function consume(){
    while(cursor<items.length){
      const index=cursor++;
      results[index]=await worker(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,limit),items.length)},consume));
  return results;
}
