import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Dance, DanceProgress } from '../types';
import { colors } from '../styles';
export function DanceCard({ dance, song, progress, onPress }: { dance:Dance; song:string; progress?:DanceProgress; onPress:()=>void }) {
  const icon=progress?.status==='learned'?'⭐':progress?.status==='want'?'💗':'♪';
  return <Pressable style={s.card} onPress={onPress}><Text style={s.icon}>{icon}</Text><View style={s.copy}><Text style={s.title}>{dance.name}</Text><Text style={s.song}>{song}</Text>{progress?.personalSongSwap&&<Text style={s.swap}>Song swap: {progress.personalSongSwap}</Text>}<Text style={s.level}>{dance.difficulty}</Text></View><Text style={s.arrow}>›</Text></Pressable>;
}
const s=StyleSheet.create({card:{backgroundColor:colors.card,borderRadius:14,padding:13,marginBottom:9,flexDirection:'row',alignItems:'center'},icon:{fontSize:23,width:38},copy:{flex:1},title:{color:colors.ink,fontSize:16,fontWeight:'800'},song:{color:colors.muted,fontSize:12,marginTop:3},swap:{color:colors.pink,fontSize:12,marginTop:5,fontWeight:'700'},level:{color:colors.green,fontSize:11,fontWeight:'700',marginTop:7},arrow:{color:colors.gold,fontSize:27}});
