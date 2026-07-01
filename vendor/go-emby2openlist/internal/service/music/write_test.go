package music_test

import (
	"os"
	"testing"

	"github.com/AmbitiousJun/go-emby2openlist/v2/internal/service/lib/ffmpeg"
	"github.com/AmbitiousJun/go-emby2openlist/v2/internal/service/music"
)

const host = "http://0.0.0.0:12345"

func TestWriteFakeMP3(t *testing.T) {
	if err := ffmpeg.AutoDownloadExec("../../.."); err != nil {
		t.Fatal(err)
		return
	}

	url := host + "/d/%E9%9F%B3%E4%B9%90/%E5%BE%90%E4%BD%B3%E8%8E%B9%E3%80%81%E9%99%88%E6%A5%9A%E7%94%9F%20-%20%E8%BA%AB%E9%AA%91%E7%99%BD%E9%A9%AC%20(Live).flac?sign=A6lbwyyDt8g2bsWB3GgfZ2aC1VGklJ2puYv_EZAJsLM=:0"
	meta, err := ffmpeg.InspectMusic(url)
	if err != nil {
		t.Fatal(err)
		return
	}
	cover, err := ffmpeg.ExtractMusicCover(url)
	if err != nil {
		t.Fatal(err)
		return
	}
	path := "../../../openlist-local-tree/音乐"
	os.MkdirAll(path, os.ModePerm)
	err = music.WriteFakeMP3(path+"/fake.flac", meta, cover)
	if err != nil {
		t.Fatal(err)
	}
}
