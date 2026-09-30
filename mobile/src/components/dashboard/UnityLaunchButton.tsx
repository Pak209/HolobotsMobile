import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GameDialogFrame, GameSurfaceFrame } from '@/components/ui/GameSurfaceFrame';
import { closeNativeUnity, openNativeUnity } from '@/lib/unity/nativeUnitySession';

/** Manual entry only. An absent native module/framework shows an error, never an imitation runtime. */
export function UnityLaunchButton() {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),starting=useRef(false),close=useRef<(()=>Promise<void>)|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(starting.current)void closeNativeUnity().catch(()=>{});else void close.current?.().catch(()=>{});};},[]);
  const launch=async()=>{
    if(starting.current)return;starting.current=true;setBusy(true);setError('');
    try{const stop=await openNativeUnity();if(!mounted.current){await stop();return;}close.current=stop;}
    catch(e){const text=e instanceof Error?e.message:'HoloCity is unavailable in this build.';if(mounted.current && text!=='HoloCity session closed')setError(text);}
    finally{starting.current=false;if(mounted.current)setBusy(false);}
  };
  return <>
    <Pressable style={styles.entry} disabled={busy} onPress={()=>void launch()} accessibilityRole="button" accessibilityLabel="Enter HoloCity" accessibilityState={{busy,disabled:busy}}>
      <GameSurfaceFrame accent="#55deef" fill="#07121b"/><Text style={styles.label}>{busy?'OPENING…':'ENTER HOLOCITY'}</Text>
    </Pressable>
    <Modal visible={!!error} transparent animationType="fade" onRequestClose={()=>setError('')}>
      <View style={styles.backdrop}><View style={styles.dialog}><GameDialogFrame accent="#f0bf14" fill="#070c12"/>
        <Text style={styles.title}>HOLOCITY UNAVAILABLE</Text><Text style={styles.message} accessibilityLiveRegion="assertive">{error}</Text>
        <Pressable style={styles.dismiss} onPress={()=>setError('')} accessibilityRole="button"><GameSurfaceFrame accent="#55deef"/><Text style={styles.label}>BACK TO DASHBOARD</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}
const styles=StyleSheet.create({entry:{position:'absolute',left:'5%',top:'12%',width:'40%',minHeight:44,zIndex:35,alignItems:'center',justifyContent:'center'},label:{color:'#fff',fontSize:12,fontWeight:'800'},backdrop:{flex:1,backgroundColor:'#000b',padding:24,justifyContent:'center',alignItems:'center'},dialog:{width:'100%',maxWidth:440,padding:26,gap:18},title:{color:'#f0bf14',fontSize:18,fontWeight:'800'},message:{color:'#fff',fontSize:15,lineHeight:22},dismiss:{minHeight:48,alignItems:'center',justifyContent:'center'}});
