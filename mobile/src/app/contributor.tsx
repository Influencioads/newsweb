import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { LoadingState } from "@/components/Feedback";
import { font } from "@/lib/theme";
import { useColors } from "@/lib/useTheme";
import { useAuth } from "@/stores/auth";

/**
 * Applying to be a contributor, from the phone.
 *
 * Most citizen journalists will only ever do this on a phone, with the ID card
 * in their hand — so the document step is a camera button, not a file picker.
 *
 * The paragraph above the upload is deliberately plain and deliberately first:
 * somebody is about to photograph their PAN card, and they should know where
 * it goes before they do, not afterwards in a policy page.
 */

type Status =
  | "not_started" | "draft" | "submitted" | "in_review"
  | "more_info" | "approved" | "rejected" | "expired";

interface DocumentRow {
  id: number;
  kind: string;
  number_masked: string | null;
}

interface Application {
  id?: number;
  status: Status;
  contributor_type: string | null;
  display_name_te?: string;
  review_note?: string | null;
  documents: DocumentRow[];
  missing: string[][];
  can_edit: boolean;
}

const TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: "citizen", label: "పౌర విలేకరి", hint: "మీ ప్రాంతంలో జరిగేది రాయడం" },
  { value: "freelance", label: "ఫ్రీలాన్స్", hint: "ప్రెస్ కార్డు లేదా పోర్ట్‌ఫోలియో" },
  { value: "student", label: "విద్యార్థి", hint: "కళాశాల గుర్తింపు కార్డు" },
];

const DOC_LABELS: Record<string, string> = {
  pan: "పాన్ కార్డు",
  voter_id: "ఓటరు కార్డు",
  driving_licence: "డ్రైవింగ్ లైసెన్స్",
  passport: "పాస్‌పోర్ట్",
  selfie: "మీ ఫోటో",
  press_accreditation: "ప్రెస్ అక్రిడిటేషన్",
  student_id: "కళాశాల ID",
  college_bonafide: "బోనఫైడ్ సర్టిఫికెట్",
};

const STATUS_TEXT: Partial<Record<Status, string>> = {
  draft: "దరఖాస్తు ఇంకా పంపలేదు. పత్రాలు జోడించి పంపండి.",
  submitted: "మీ దరఖాస్తు అందింది. త్వరలో పరిశీలిస్తాం.",
  in_review: "మీ దరఖాస్తు సమీక్షలో ఉంది.",
  more_info: "మరికొంత సమాచారం కావాలి.",
  approved: "మీరు ధృవీకరించబడ్డారు. ఇప్పుడు కథనాలు పంపవచ్చు.",
  rejected: "ఈసారి ఆమోదించలేకపోయాం.",
  expired: "ధృవీకరణ గడువు ముగిసింది. మళ్లీ దరఖాస్తు చేయండి.",
};

export default function ContributorScreen() {
  const c = useColors();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.me);

  const [type, setType] = useState("citizen");
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");

  const application = useQuery({
    queryKey: ["contributor", "me"],
    queryFn: async () =>
      (await api.get<Application>("/users/me/contributor")).data,
    enabled: Boolean(me),
    retry: false,
  });

  useEffect(() => {
    const data = application.data;
    if (!data) return;
    if (data.contributor_type) setType(data.contributor_type);
    if (data.display_name_te) setName(data.display_name_te);
  }, [application.data]);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["contributor"] });

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post("/users/me/contributor", {
          contributor_type: type,
          display_name_te: name,
          organisation: organisation || null,
        })
      ).data,
    onSuccess: refresh,
    onError: () => Alert.alert("సేవ్ కాలేదు", "మళ్లీ ప్రయత్నించండి."),
  });

  const upload = useMutation({
    mutationFn: async ({ kind, uri }: { kind: string; uri: string }) => {
      const form = new FormData();
      form.append("kind", kind);
      // React Native's FormData takes this shape for a file; the cast is the
      // standard workaround for its DOM-typed signature.
      form.append("file", {
        uri,
        name: `${kind}.jpg`,
        type: "image/jpeg",
      } as unknown as Blob);
      return (await api.post("/users/me/contributor/documents", form)).data;
    },
    onSuccess: refresh,
    onError: () =>
      Alert.alert("అప్‌లోడ్ కాలేదు", "ఫోటో స్పష్టంగా ఉందో చూసి మళ్లీ ప్రయత్నించండి."),
  });

  const submit = useMutation({
    mutationFn: async () =>
      (await api.post("/users/me/contributor/submit")).data,
    onSuccess: refresh,
    onError: (error: unknown) => {
      const message =
        (error as { displayMessage?: string })?.displayMessage ??
        "పంపడం విఫలమైంది.";
      Alert.alert("పంపలేకపోయాం", message);
    },
  });

  async function pick(kind: string) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    const result = permission.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.uri) upload.mutate({ kind, uri: asset.uri });
  }

  if (!me) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
        <Stack.Screen options={{ title: "మాతో కలిసి రాయండి" }} />
        <Text style={[s.body, { color: c.ink, padding: 16 }]}>
          దరఖాస్తు చేయడానికి సైన్ ఇన్ చేయండి.
        </Text>
      </SafeAreaView>
    );
  }

  const data = application.data;
  const canEdit = data?.can_edit ?? true;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["bottom"]}>
      <Stack.Screen options={{ title: "మాతో కలిసి రాయండి" }} />
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={[s.intro, { color: c.inkSoft }]}>
          పౌరులు, ఫ్రీలాన్స్, విద్యార్థి జర్నలిస్టులు తమ ప్రాంతం నుంచి కథనాలు
          పంపవచ్చు. ఒకసారి గుర్తింపు ధృవీకరించుకుంటే మీ పేరుపై అది కనిపిస్తుంది.
        </Text>

        {application.isLoading ? <LoadingState /> : null}

        {data && data.status !== "not_started" && STATUS_TEXT[data.status] ? (
          <View style={[s.notice, { borderColor: c.rule, backgroundColor: c.paper }]}>
            <Text style={[s.body, { color: c.ink }]}>{STATUS_TEXT[data.status]}</Text>
            {data.review_note ? (
              <Text style={[s.body, { color: c.inkSoft, marginTop: 6 }]}>
                {data.review_note}
              </Text>
            ) : null}
            {data.status === "approved" ? (
              <Pressable onPress={() => router.push("/submit")} style={s.linkRow}>
                <Text style={[s.link, { color: c.brand }]}>కథనం పంపండి →</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {canEdit ? (
          <View style={[s.card, { borderColor: c.rule, backgroundColor: c.paper }]}>
            <Text style={[s.label, { color: c.ink }]}>మీరు ఎవరిగా దరఖాస్తు చేస్తున్నారు</Text>
            {TYPES.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: type === option.value }}
                onPress={() => setType(option.value)}
                style={[
                  s.option,
                  { borderColor: type === option.value ? c.brand : c.rule },
                ]}
              >
                <Text style={[s.optionLabel, { color: c.ink }]}>{option.label}</Text>
                <Text style={[s.optionHint, { color: c.muted }]}>{option.hint}</Text>
              </Pressable>
            ))}

            <Text style={[s.label, { color: c.ink, marginTop: 14 }]}>
              మీ కథనాలపై కనిపించే పేరు
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={[s.input, { borderColor: c.rule, color: c.ink }]}
            />

            {type !== "citizen" ? (
              <>
                <Text style={[s.label, { color: c.ink, marginTop: 14 }]}>
                  {type === "student" ? "మీ కళాశాల" : "మీరు రాసే సంస్థ"}
                </Text>
                <TextInput
                  value={organisation}
                  onChangeText={setOrganisation}
                  style={[s.input, { borderColor: c.rule, color: c.ink }]}
                />
              </>
            ) : null}

            <Pressable
              disabled={save.isPending || name.trim().length < 2}
              onPress={() => save.mutate()}
              style={[
                s.primary,
                {
                  backgroundColor: c.brand,
                  opacity: save.isPending || name.trim().length < 2 ? 0.5 : 1,
                },
              ]}
            >
              <Text style={s.primaryLabel}>
                {save.isPending ? "సేవ్ అవుతోంది…" : "సేవ్ చేయండి"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {data?.id ? (
          <View style={[s.card, { borderColor: c.rule, backgroundColor: c.paper }]}>
            <Text style={[s.label, { color: c.ink }]}>మీ పత్రాలు</Text>

            <Text style={[s.privacy, { color: c.inkSoft, borderColor: c.rule }]}>
              మీ గుర్తింపు పత్రం ప్రైవేటుగా భద్రపరుస్తాం — బహిరంగ లింక్ ఉండదు.
              సీనియర్ ఎడిటర్లు మాత్రమే చూడగలరు, ప్రతిసారీ అది నమోదవుతుంది,
              గడువు ముగిశాక తొలగిస్తాం.
            </Text>

            {data.documents.map((doc) => (
              <Text key={doc.id} style={[s.body, { color: c.inkSoft, marginTop: 6 }]}>
                ✓ {DOC_LABELS[doc.kind] ?? doc.kind}
                {doc.number_masked ? `  ${doc.number_masked}` : ""}
              </Text>
            ))}

            {canEdit
              ? data.missing.map((group) => (
                  <Pressable
                    key={group.join("-")}
                    disabled={upload.isPending}
                    onPress={() => pick(group[0] ?? "")}
                    style={[s.upload, { borderColor: c.brand }]}
                  >
                    <Text style={[s.uploadLabel, { color: c.brand }]}>
                      📷 {group.map((k) => DOC_LABELS[k] ?? k).join(" లేదా ")}
                    </Text>
                  </Pressable>
                ))
              : null}

            {canEdit && data.missing.length === 0 ? (
              <Pressable
                disabled={submit.isPending}
                onPress={() => submit.mutate()}
                style={[
                  s.primary,
                  { backgroundColor: c.brand, opacity: submit.isPending ? 0.5 : 1 },
                ]}
              >
                <Text style={s.primaryLabel}>
                  {submit.isPending ? "పంపుతోంది…" : "ధృవీకరణకు పంపండి"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text style={[s.footer, { color: c.muted }]}>
          ధృవీకరణ వల్ల మీరు ఎక్కువ కథనాలు పంపవచ్చు, ఫోటోలు జోడించవచ్చు. ప్రతి
          కథనాన్ని ఎడిటర్ చదివాకే ప్రచురిస్తాం — అది మారదు.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  intro: { fontFamily: font.telugu, fontSize: 13.5, lineHeight: 23, marginBottom: 14 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  label: { fontFamily: font.teluguBold, fontSize: 14, lineHeight: 24, marginBottom: 8 },
  body: { fontFamily: font.telugu, fontSize: 13.5, lineHeight: 23 },
  option: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8, minHeight: 44 },
  optionLabel: { fontFamily: font.teluguSemiBold, fontSize: 14, lineHeight: 24 },
  optionHint: { fontFamily: font.telugu, fontSize: 12, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 46,
    paddingHorizontal: 12,
    fontFamily: font.telugu,
    fontSize: 15,
  },
  privacy: {
    fontFamily: font.telugu,
    fontSize: 12,
    lineHeight: 21,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 4,
  },
  upload: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    marginTop: 10,
  },
  uploadLabel: { fontFamily: font.teluguSemiBold, fontSize: 13.5 },
  primary: {
    minHeight: 48,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  primaryLabel: { fontFamily: font.teluguBold, fontSize: 15, color: "#fff" },
  linkRow: { marginTop: 8, minHeight: 44, justifyContent: "center" },
  link: { fontFamily: font.teluguSemiBold, fontSize: 13.5 },
  footer: { fontFamily: font.telugu, fontSize: 12, lineHeight: 21, marginTop: 4 },
});
