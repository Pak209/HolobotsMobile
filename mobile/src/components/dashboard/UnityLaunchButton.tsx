import { theme } from "@/theme";
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GameDialogFrame, GameSurfaceFrame } from '@/components/ui/GameSurfaceFrame';
import { closeNativeUnity, hasNativeUnity, NATIVE_CITY_COPY, nativeCityErrorText, openNativeUnity } from '@/lib/unity/nativeUnitySession';

/** Manual entry only, and only in builds with the native runtime (L17); never an imitation runtime. */
export function UnityLaunchButton({ inline = false, compact = false }: { inline?: boolean; compact?: boolean }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),starting=useRef(false),close=useRef<(()=>Promise<void>)|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(starting.current)void closeNativeUnity().catch(()=>{});else void close.current?.().catch(()=>{});};},[]);
  const launch=async()=>{
    if(starting.current)return;starting.current=true;setBusy(true);setError('');
    try{const stop=await openNativeUnity();if(!mounted.current){await stop();return;}close.current=stop;}
    catch(e){const text=nativeCityErrorText(e);if(mounted.current && text)setError(text);}
    finally{starting.current=false;if(mounted.current)setBusy(false);}
  };
  if(!hasNativeUnity())return null;
  return <>
    <Pressable style={[inline ? styles.inlineEntry : styles.entry, compact && { minHeight: 32 }]} disabled={busy} onPress={()=>void launch()} accessibilityRole="button" accessibilityLabel={NATIVE_CITY_COPY.accessibility} accessibilityState={{busy,disabled:busy}}>
      <GameSurfaceFrame accent={theme.colors.accent} fill={theme.plates.navy}/><Text style={[styles.label, compact && { fontSize: 9 }]}>{busy?NATIVE_CITY_COPY.opening:NATIVE_CITY_COPY.label}</Text>
    </Pressable>
    <Modal visible={!!error} transparent animationType="fade" onRequestClose={()=>setError('')}>
      <View style={styles.backdrop}><View style={styles.dialog}><GameDialogFrame accent={theme.colors.accent} fill={theme.plates.navy}/>
        <Text style={styles.title}>{NATIVE_CITY_COPY.unavailableTitle}</Text><Text style={styles.message} accessibilityLiveRegion="assertive">{error}</Text>
        <Pressable style={styles.dismiss} onPress={()=>setError('')} accessibilityRole="button"><GameSurfaceFrame accent={theme.colors.accent}/><Text style={styles.label}>{NATIVE_CITY_COPY.back}</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}
const styles=StyleSheet.create({inlineEntry:{flex:1,minHeight:48,alignItems:"center",justifyContent:"center"},entry:{position:'absolute',left:'5%',top:'12%',width:'40%',minHeight:44,zIndex:35,alignItems:'center',justifyContent:'center'},label:{color:theme.colors.text,fontSize:12,fontWeight:'800'},backdrop:{flex:1,backgroundColor:'#000b',padding:24,justifyContent:'center',alignItems:'center'},dialog:{width:'100%',maxWidth:440,padding:26,gap:18},title:{color:theme.colors.accent,fontSize:18,fontWeight:'800'},message:{color:theme.colors.text,fontSize:15,lineHeight:22},dismiss:{minHeight:48,alignItems:'center',justifyContent:'center'}});
