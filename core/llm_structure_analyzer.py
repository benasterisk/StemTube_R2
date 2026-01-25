"""
LLM-based Musical Structure Analyzer
Uses local Phi-3-mini via Ollama to analyze song structure from multi-modal data
"""

import logging
import json
import requests
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class LLMStructureAnalyzer:
    """
    Analyzes musical structure using a local LLM (Phi-3-mini via Ollama)
    """

    def __init__(self, model: str = "phi3:mini", ollama_url: str = "http://localhost:11434"):
        """
        Initialize LLM analyzer

        Args:
            model: Ollama model name (default: phi3:mini)
            ollama_url: Ollama API endpoint
        """
        self.model = model
        self.ollama_url = ollama_url
        self.api_endpoint = f"{ollama_url}/api/generate"

    def analyze_structure(
        self,
        title: str,
        artist: Optional[str],
        key: Optional[str],
        bpm: Optional[float],
        duration: float,
        lyrics: List[Dict],
        chords: List[Dict],
        msaf_segments: Optional[List[Dict]] = None
    ) -> Dict:
        """
        Analyze song structure using LLM

        Args:
            title: Song title
            artist: Artist name
            key: Musical key (e.g., "F major")
            bpm: Tempo in beats per minute
            duration: Total duration in seconds
            lyrics: List of lyric segments with timestamps
            chords: List of chord changes with timestamps
            msaf_segments: Optional MSAF audio segmentation

        Returns:
            Dict containing detected structure and analysis
        """
        try:
            # Build comprehensive analysis prompt
            prompt = self._build_analysis_prompt(
                title, artist, key, bpm, duration, lyrics, chords, msaf_segments
            )

            logger.info(f"[LLM] Analyzing structure for '{title}' with {self.model}")

            # Call Ollama API
            response = requests.post(
                self.api_endpoint,
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",  # Request JSON output
                    "options": {
                        "temperature": 0.3,  # Low temperature for factual analysis
                        "top_p": 0.9
                    }
                },
                timeout=60
            )

            if response.status_code != 200:
                logger.error(f"[LLM] API error: {response.status_code}")
                return self._fallback_structure(duration)

            result = response.json()
            llm_output = result.get('response', '')

            # Parse LLM JSON response
            try:
                structure_data = json.loads(llm_output)
                logger.info(f"[LLM] Analysis complete: {len(structure_data.get('sections', []))} sections detected")
                return structure_data
            except json.JSONDecodeError:
                logger.warning("[LLM] Failed to parse JSON, using fallback")
                return self._fallback_structure(duration)

        except Exception as e:
            logger.error(f"[LLM] Error during analysis: {e}", exc_info=True)
            return self._fallback_structure(duration)

    def _build_analysis_prompt(
        self,
        title: str,
        artist: Optional[str],
        key: Optional[str],
        bpm: Optional[float],
        duration: float,
        lyrics: List[Dict],
        chords: List[Dict],
        msaf_segments: Optional[List[Dict]]
    ) -> str:
        """Build comprehensive analysis prompt for LLM"""

        # Format chord progression summary
        chord_summary = self._summarize_chords(chords, duration)

        # Format lyrics summary
        lyrics_summary = self._summarize_lyrics(lyrics, duration)

        # Format MSAF boundaries summary
        msaf_summary = self._summarize_msaf(msaf_segments) if msaf_segments else "No MSAF audio analysis available."

        # Build prompt
        prompt = f"""You are a professional music analyst. Analyze this song's structure and return a JSON response.

SONG INFORMATION:
- Title: {title}
- Artist: {artist or 'Unknown'}
- Key: {key or 'Unknown'}
- BPM: {bpm or 'Unknown'}
- Duration: {duration:.1f} seconds (~{int(duration/60)}:{int(duration%60):02d})

MSAF AUDIO BOUNDARIES (Audio-based ground truth):
{msaf_summary}

CHORD PROGRESSION ANALYSIS:
{chord_summary}

LYRICS TIMING ANALYSIS:
{lyrics_summary}

TASK:
Analyze this data and determine the song structure. Common sections include:
- INTRO (instrumental opening)
- VERSE (storytelling, varying lyrics)
- CHORUS (repeated hook, main message)
- BRIDGE (contrasting section)
- SOLO (instrumental section with no vocals)
- OUTRO (ending/fade out)

RESPONSE FORMAT (STRICT JSON):
{{
  "sections": [
    {{
      "type": "INTRO",
      "start": 0.0,
      "end": 15.5,
      "confidence": 0.95,
      "description": "Instrumental intro establishing key and tempo"
    }},
    {{
      "type": "VERSE_1",
      "start": 15.5,
      "end": 45.2,
      "confidence": 0.88,
      "description": "First verse with storytelling lyrics"
    }}
  ],
  "pattern": "INTRO-VERSE-CHORUS-VERSE-CHORUS-BRIDGE-CHORUS-OUTRO",
  "genre_hints": "Folk/Country ballad",
  "analysis": "Classic AABA structure with slow tempo and contemplative mood"
}}

IMPORTANT RULES:
1. **USE MSAF BOUNDARIES as the primary timestamp reference** - these are audio-based ground truth
2. Align your section timestamps to match or closely follow MSAF boundaries
3. Use lyrics and chords to identify WHAT each MSAF section is (verse/chorus/bridge/etc)
4. Intro = instrumental before first lyrics
5. Chorus = repeated lyrics/chords (appears 2-3+ times)
6. Verse = unique lyrics each time, similar chords
7. Bridge = different chord progression, usually appears once
8. Solo = gap in lyrics with active chord progression
9. Number verses/choruses sequentially (VERSE_1, VERSE_2, CHORUS_1, etc.)

**CRITICAL**: Your timestamps MUST align with MSAF boundaries. Use lyrics/chords only to label WHAT each section is, not WHEN it starts.

Return ONLY valid JSON, no explanations outside the JSON."""

        return prompt

    def _summarize_msaf(self, msaf_segments: List[Dict]) -> str:
        """Summarize MSAF audio boundaries for LLM"""
        if not msaf_segments:
            return "No MSAF data available."

        summary = f"MSAF detected {len(msaf_segments)} audio-based boundaries:\n\n"

        for i, seg in enumerate(msaf_segments, 1):
            start = seg['start']
            end = seg['end']
            duration = end - start
            label = seg.get('label', 'Section')

            start_min = int(start // 60)
            start_sec = int(start % 60)
            end_min = int(end // 60)
            end_sec = int(end % 60)

            summary += f"{i}. {start_min:02d}:{start_sec:02d} - {end_min:02d}:{end_sec:02d} ({duration:.1f}s) [{label}]\n"

        summary += "\n**These timestamps are audio-based ground truth - use them as your primary reference!**"
        return summary

    def _summarize_chords(self, chords: List[Dict], duration: float) -> str:
        """Summarize chord progression for LLM"""
        if not chords:
            return "No chord data available."

        # Extract key patterns
        patterns = []
        window_size = 4

        for i in range(0, len(chords) - window_size + 1, window_size):
            pattern_chords = [chords[i+j]['chord'] for j in range(window_size)]
            time = chords[i]['timestamp']
            patterns.append(f"{time:.1f}s: {' → '.join(pattern_chords)}")

        summary = f"Total chord changes: {len(chords)}\n"
        summary += f"Chord density: {len(chords)/duration:.2f} changes/second\n"
        summary += f"Key patterns (4-chord sequences):\n"
        summary += "\n".join(patterns[:8])  # Show first 8 patterns

        return summary

    def _summarize_lyrics(self, lyrics: List[Dict], duration: float) -> str:
        """Summarize lyrics timing for LLM"""
        if not lyrics:
            return "No lyrics available (instrumental track)."

        intro_duration = lyrics[0]['start'] if lyrics else 0

        summary = f"Lyrics start: {intro_duration:.1f}s (intro duration)\n"
        summary += f"Total lyric segments: {len(lyrics)}\n"
        summary += f"Lyrics coverage: {sum(seg['end']-seg['start'] for seg in lyrics)/duration*100:.1f}%\n\n"
        summary += "Segment timings:\n"

        for i, seg in enumerate(lyrics[:8], 1):  # Show first 8 segments
            word_count = len(seg['text'].split())
            summary += f"{i}. {seg['start']:.1f}s - {seg['end']:.1f}s ({word_count} words)\n"

        if len(lyrics) > 8:
            summary += f"... and {len(lyrics) - 8} more segments\n"

        return summary

    def _fallback_structure(self, duration: float) -> Dict:
        """Fallback structure when LLM fails"""
        return {
            "sections": [
                {
                    "type": "UNKNOWN",
                    "start": 0.0,
                    "end": duration,
                    "confidence": 0.0,
                    "description": "LLM analysis failed, structure unknown"
                }
            ],
            "pattern": "UNKNOWN",
            "genre_hints": "Unknown",
            "analysis": "Automatic structure detection unavailable"
        }


def analyze_song_structure(
    title: str,
    artist: Optional[str],
    key: Optional[str],
    bpm: Optional[float],
    duration: float,
    lyrics: List[Dict],
    chords: List[Dict],
    msaf_segments: Optional[List[Dict]] = None
) -> Dict:
    """
    Main function to analyze song structure using LLM

    Args:
        title: Song title
        artist: Artist name
        key: Musical key
        bpm: Tempo
        duration: Song duration in seconds
        lyrics: Lyrics data with timestamps
        chords: Chord progression data
        msaf_segments: Optional MSAF segmentation

    Returns:
        Structure analysis dict
    """
    analyzer = LLMStructureAnalyzer()
    return analyzer.analyze_structure(
        title=title,
        artist=artist,
        key=key,
        bpm=bpm,
        duration=duration,
        lyrics=lyrics,
        chords=chords,
        msaf_segments=msaf_segments
    )


# Test if run directly
if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)

    # Test data
    test_lyrics = [
        {"start": 34.2, "end": 46.1, "text": "I want to live, I want to give"},
        {"start": 46.1, "end": 57.8, "text": "I've been a miner for a heart of gold"},
        {"start": 57.8, "end": 70.3, "text": "And I'm getting old"}
    ]

    test_chords = [
        {"timestamp": 0.3, "chord": "Em"},
        {"timestamp": 3.2, "chord": "D"},
        {"timestamp": 4.2, "chord": "Em"}
    ]

    result = analyze_song_structure(
        title="Heart of Gold",
        artist="Neil Young",
        key="F major",
        bpm=84.7,
        duration=173.1,
        lyrics=test_lyrics,
        chords=test_chords
    )

    print(json.dumps(result, indent=2))
