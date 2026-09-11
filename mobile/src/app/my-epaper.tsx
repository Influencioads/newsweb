import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as api from "@/api/epaper";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";
import { useAuth } from "@/stores/auth";
type Preference = { preference_type: "category" | "district" | "mandal" | "tag"; target_id: number; priority: number };
export default function Screen() {
  const c = useColors();
  const me = useAuth((x) => x.me);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [selected, setSelected] = useState<Preference[]>([]);
  const toggle = (preference_type: Preference["preference_type"], target_id: number) =>
    setSelected((current) => current.some((x) => x.preference_type === preference_type && x.target_id === target_id)
      ? current.filter((x) => !(x.preference_type === preference_type && x.target_id === target_id))
      : [...current, { preference_type, target_id, priority: current.length }]);
  const chosen = (type: Preference["preference_type"], id: number) => selected.some((x) => x.preference_type === type && x.target_id === id);
  const opts = useQuery({
    queryKey: ["epaper-options"],
    queryFn: api.fetchOptions,
  });
  const mine = useQuery({
    queryKey: ["my-epaper"],
    queryFn: api.fetchMine,
    enabled: Boolean(me),
  });
  const create = useMutation({
    mutationFn: () =>
      api.createMine({
        name,
        auto_generate: true,
        generation_time: "06:00:00",
        preferences: selected,
      }),
    onSuccess: () => {
      setName("");
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ["my-epaper"] });
    },
  });
  const generate = useMutation({
    mutationFn: api.generateMine,
    onSuccess: (e) =>
      router.push({
        pathname: "/my-epaper-edition/[id]",
        params: { id: String(e.id) },
      }),
  });
  const rename = useMutation({
    mutationFn: (row: api.UserEdition) => api.updateMine(row.id, { name: editingName, auto_generate: row.auto_generate, generation_time: row.generation_time, preferences: row.preferences }),
    onSuccess: () => { setEditingId(null); void qc.invalidateQueries({ queryKey: ["my-epaper"] }); },
  });
  if (!me)
    return (
      <View style={s.center}>
        <Text style={[s.heading, { color: c.ink }]}>
          మీ ఈ-పేపర్ కోసం ప్రొఫైల్‌లో లాగిన్ అవ్వండి.
        </Text>
      </View>
    );
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={[s.heading, { color: c.ink }]}>నా ఈ-పేపర్ సృష్టించండి</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="అజయ్ మార్నింగ్ ఎడిషన్"
        placeholderTextColor={c.muted}
        style={[
          s.input,
          { color: c.ink, borderColor: c.rule, backgroundColor: c.paper },
        ]}
      />
      <Text style={[s.label, { color: c.ink }]}>విభాగాలు మరియు ఆసక్తులు</Text>
      <View style={s.chips}>
        {opts.data?.categories.map((x) => (
          <Pressable
            key={x.id}
            onPress={() => toggle("category", x.id)}
            style={[
              s.chip,
              {
                borderColor: c.rule,
                backgroundColor: chosen("category", x.id) ? c.brand : c.paper,
              },
            ]}
          >
            <Text
              style={{
                fontFamily: font.teluguSemiBold,
                color: chosen("category", x.id) ? c.onBrand : c.ink,
              }}
            >
              {x.name_te}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.label, { color: c.ink }]}>అంశాలు</Text>
      <View style={s.chips}>{opts.data?.tags.map((x) => <Choice key={x.id} label={x.name_te} active={chosen("tag", x.id)} onPress={() => toggle("tag", x.id)} />)}</View>
      <Text style={[s.label, { color: c.ink }]}>జిల్లాలు / ప్రాంతాలు</Text>
      <View style={s.chips}>{opts.data?.districts.map((x) => <Choice key={x.id} label={x.name_te} active={chosen("district", x.id)} onPress={() => toggle("district", x.id)} />)}</View>
      <Text style={[s.label, { color: c.ink }]}>మండలాలు</Text>
      <View style={s.chips}>{opts.data?.mandals.map((x) => <Choice key={x.id} label={x.name_te} active={chosen("mandal", x.id)} onPress={() => toggle("mandal", x.id)} />)}</View>
      <Pressable
        disabled={name.length < 2 || !selected.length}
        onPress={() => create.mutate()}
        style={[s.primary, { backgroundColor: c.brand }]}
      >
        <Text style={{ color: c.onBrand, fontWeight: "800" }}>
          రోజువారీ ఎడిషన్ సేవ్ చేయండి
        </Text>
      </Pressable>
      <Text style={[s.subheading, { color: c.ink }]}>నా ఎడిషన్లు</Text>
      {mine.data?.items
        .filter((x) => x.is_active)
        .map((x) => (
          <View
            key={x.id}
            style={[s.card, { borderColor: c.rule, backgroundColor: c.paper }]}
          >
            <Text style={[s.cardTitle, { color: c.ink }]}>{x.name}</Text>
            {editingId === x.id ? <TextInput value={editingName} onChangeText={setEditingName} style={[s.input,{color:c.ink,borderColor:c.rule}]} /> : null}
            <Text style={{ color: c.muted }}>
              {x.preferences.length} అభిరుచులు · {x.generation_time}
            </Text>
            <View style={s.row}>
              <Pressable
                style={[s.small, { backgroundColor: c.brand }]}
                onPress={() => generate.mutate(x.id)}
              >
                <Text style={{ color: c.onBrand, fontWeight: "700" }}>
                  ఈ రోజు చదవండి
                </Text>
              </Pressable>
              <Pressable style={[s.small, { borderColor: c.rule, borderWidth: 1 }]} onPress={() => { if (editingId === x.id) rename.mutate(x); else { setEditingId(x.id); setEditingName(x.name); } }}><Text style={{ color: c.brand }}>{editingId === x.id ? "సేవ్" : "పేరు మార్చు"}</Text></Pressable>
              <Pressable
                style={[s.small, { borderColor: c.rule, borderWidth: 1 }]}
                onPress={() =>
                  api
                    .deleteMine(x.id)
                    .then(() =>
                      qc.invalidateQueries({ queryKey: ["my-epaper"] }),
                    )
                }
              >
                <Text style={{ color: c.breaking }}>నిలిపివేయండి</Text>
              </Pressable>
            </View>
          </View>
        ))}
    </ScrollView>
  );
}
function Choice({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}) { const c=useColors(); return <Pressable onPress={onPress} style={[s.chip,{borderColor:c.rule,backgroundColor:active?c.brand:c.paper}]}><Text style={{fontFamily:font.teluguSemiBold,color:active?c.onBrand:c.ink}}>{label}</Text></Pressable> }
const s = StyleSheet.create({
  body: { padding: 16 },
  center: { padding: 30 },
  heading: { fontFamily: font.headlineHeavy, fontSize: 28, lineHeight: 43 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
    fontFamily: font.telugu,
  },
  label: { fontFamily: font.teluguBold, marginTop: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primary: {
    alignSelf: "flex-start",
    padding: 13,
    borderRadius: 7,
    marginTop: 16,
  },
  subheading: {
    fontFamily: font.headlineHeavy,
    fontSize: 23,
    lineHeight: 36,
    marginTop: 26,
  },
  card: { borderWidth: 1, borderRadius: 9, padding: 14, marginTop: 10 },
  cardTitle: { fontFamily: font.headlineHeavy, fontSize: 20, lineHeight: 30 },
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  small: { padding: 10, borderRadius: 6 },
});
